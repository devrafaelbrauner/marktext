import path from 'path'
import type { VaultChangeEvent } from '@shared/plugins/types'
import type { VaultIndexReadyState } from '@shared/types/ipc'
import type { WatcherTapEvent } from '../filesystem/watcherTap'
import type {
  MainToWorkerMessage,
  VaultFsChange,
  VaultIndexQueries,
  VaultIndexQueryMethod,
  WorkerToMainMessage
} from './types'

/** Transport to one index worker; desktop wraps an Electron utility process, Android a Web Worker. */
export interface IndexWorkerProcess {
  postMessage(message: MainToWorkerMessage): void
  onMessage(listener: (message: WorkerToMainMessage) => void): void
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface VaultIndexManagerOptions {
  /** Persisted cache of a root (`<userData>/vault-index/<sha1(root)>.json`); null disables persistence. */
  getCacheFile: (rootPath: string) => string | null
  /** Current `treePathExcludePatterns` preference. */
  getExcludePatterns: () => string[]
  spawnWorker: (rootPath: string) => IndexWorkerProcess
  sendToWindow: (windowId: number, channel: 'mt::index::changed' | 'mt::index::ready', payload: VaultChangeEvent | VaultIndexReadyState) => void
  log?: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
  /** Window for coalescing watcher events of all windows showing the same root. */
  fsBatchMs?: number
  /** Window for coalescing `mt::index::changed` pushes. */
  changeDebounceMs?: number
  /** Grace period before the worker of a root without windows is stopped (covers window reloads). */
  idleDisposeMs?: number
}

interface PendingReply {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface RootEntry {
  rootPath: string
  windows: Set<number>
  worker: IndexWorkerProcess | null
  ready: boolean
  disposing: boolean
  restarts: number
  nextId: number
  pending: Map<number, PendingReply>
  fsQueue: Map<string, VaultFsChange>
  fsTimer: NodeJS.Timeout | undefined
  changed: Set<string>
  removed: Set<string>
  changeTimer: NodeJS.Timeout | undefined
  disposeTimer: NodeJS.Timeout | undefined
}

const MAX_RESTARTS = 3
const EMPTY_RESULTS: { [K in VaultIndexQueryMethod]: VaultIndexQueries[K]['ret'] } = {
  getFile: null,
  listFiles: [],
  resolveLink: null,
  getBacklinks: [],
  getTags: [],
  getFilesWithTag: []
}

const isInside = (rootPath: string, pathname: string): boolean => {
  const rel = path.relative(rootPath, pathname)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Owns one index worker per opened root folder, shared by every window
 * showing that root. Learns window ↔ root assignments and file events from
 * the folder watcher tap, routes queries of a window to its root's worker
 * and pushes readiness and (debounced) change events back to the windows of
 * that root. A window without an opened folder gets empty results.
 */
export class VaultIndexManager {
  private readonly _options: VaultIndexManagerOptions
  private readonly _roots = new Map<string, RootEntry>()
  private readonly _windowRoots = new Map<number, string>()

  constructor(options: VaultIndexManagerOptions) {
    this._options = options
  }

  handleWatcherEvent(event: WatcherTapEvent): void {
    switch (event.type) {
      case 'watch':
        this.attachWindow(event.windowId, event.rootPath)
        break
      case 'unwatch':
        this.detachWindow(event.windowId, event.rootPath)
        break
      default: {
        const entry = this._roots.get(path.resolve(event.rootPath))
        if (entry) this._queueFs(entry, { type: event.type, path: event.pathname })
      }
    }
  }

  /** Assigns `rootPath` to a window, starting the root's worker when needed. */
  attachWindow(windowId: number, rootPath: string): void {
    const key = path.resolve(rootPath)
    const previous = this._windowRoots.get(windowId)
    if (previous === key) return
    if (previous) this.detachWindow(windowId, previous)

    let entry = this._roots.get(key)
    if (!entry) {
      entry = this._createEntry(key)
      this._roots.set(key, entry)
    }
    clearTimeout(entry.disposeTimer)
    entry.disposeTimer = undefined
    entry.windows.add(windowId)
    this._windowRoots.set(windowId, key)
    if (!entry.worker) this._startWorker(entry)
    this._options.sendToWindow(windowId, 'mt::index::ready', { rootPath: key, ready: entry.ready })
  }

  /** Removes the window from `rootPath`; the worker stops after the idle grace period. */
  detachWindow(windowId: number, rootPath: string): void {
    const key = path.resolve(rootPath)
    if (this._windowRoots.get(windowId) !== key) return
    this._windowRoots.delete(windowId)
    const entry = this._roots.get(key)
    if (!entry) return
    entry.windows.delete(windowId)
    this._options.sendToWindow(windowId, 'mt::index::ready', { rootPath: null, ready: false })
    if (entry.windows.size === 0) {
      clearTimeout(entry.disposeTimer)
      entry.disposeTimer = setTimeout(() => this._disposeEntry(entry), this._options.idleDisposeMs ?? 5000)
    }
  }

  /** A file was written by the app (save, save as). */
  notifySaved(pathname: string): void {
    for (const entry of this._roots.values()) {
      if (isInside(entry.rootPath, pathname)) this._queueFs(entry, { type: 'change', path: pathname })
    }
  }

  /** A file was renamed or moved by the app. */
  notifyRenamed(pathname: string, oldPathname: string): void {
    for (const entry of this._roots.values()) {
      if (isInside(entry.rootPath, oldPathname)) this._queueFs(entry, { type: 'unlink', path: oldPathname })
      if (isInside(entry.rootPath, pathname)) this._queueFs(entry, { type: 'add', path: pathname })
    }
  }

  /** Re-scans every vault with new exclude patterns. */
  setExcludePatterns(patterns: string[]): void {
    for (const entry of this._roots.values()) {
      entry.worker?.postMessage({ kind: 'config', excludePatterns: patterns })
    }
  }

  getRootPath(windowId: number): string | null {
    return this._windowRoots.get(windowId) ?? null
  }

  isReady(windowId: number): boolean {
    const key = this._windowRoots.get(windowId)
    return key ? this._roots.get(key)?.ready === true : false
  }

  /** Runs an index query for the window's root; empty/null without one. */
  query<K extends VaultIndexQueryMethod>(windowId: number, method: K, args: VaultIndexQueries[K]['args']): Promise<VaultIndexQueries[K]['ret']> {
    const entry = this._entryOf(windowId)
    if (!entry) return Promise.resolve(EMPTY_RESULTS[method])
    return this._call(entry, (id) => ({ kind: 'query', id, method, args })) as Promise<VaultIndexQueries[K]['ret']>
  }

  /** Calls a worker handler (registerWorkerHandler) for the window's root; null without one. */
  request(windowId: number, type: string, payload: unknown): Promise<unknown> {
    const entry = this._entryOf(windowId)
    if (!entry) return Promise.resolve(null)
    return this._call(entry, (id) => ({ kind: 'request', id, type, payload }))
  }

  /** Stops every worker (each flushes its cache first). */
  dispose(): void {
    for (const entry of [...this._roots.values()]) this._disposeEntry(entry)
    this._windowRoots.clear()
  }

  // --- internals -----------------------------------------------------------

  private _entryOf(windowId: number): RootEntry | null {
    const key = this._windowRoots.get(windowId)
    const entry = key ? this._roots.get(key) : undefined
    return entry?.worker ? entry : null
  }

  private _createEntry(rootPath: string): RootEntry {
    return {
      rootPath,
      windows: new Set(),
      worker: null,
      ready: false,
      disposing: false,
      restarts: 0,
      nextId: 1,
      pending: new Map(),
      fsQueue: new Map(),
      fsTimer: undefined,
      changed: new Set(),
      removed: new Set(),
      changeTimer: undefined,
      disposeTimer: undefined
    }
  }

  private _startWorker(entry: RootEntry): void {
    const worker = this._options.spawnWorker(entry.rootPath)
    entry.worker = worker
    entry.ready = false
    worker.onMessage((message) => this._onWorkerMessage(entry, worker, message))
    worker.onExit((code) => this._onWorkerExit(entry, worker, code))
    worker.postMessage({
      kind: 'init',
      rootPath: entry.rootPath,
      cacheFile: this._options.getCacheFile(entry.rootPath),
      excludePatterns: this._options.getExcludePatterns()
    })
  }

  private _onWorkerMessage(entry: RootEntry, worker: IndexWorkerProcess, message: WorkerToMainMessage): void {
    if (entry.worker !== worker) return
    switch (message.kind) {
      case 'ready':
        entry.ready = true
        entry.restarts = 0
        for (const windowId of entry.windows) {
          this._options.sendToWindow(windowId, 'mt::index::ready', { rootPath: entry.rootPath, ready: true })
        }
        break
      case 'changed':
        for (const file of message.event.changed) {
          entry.removed.delete(file)
          entry.changed.add(file)
        }
        for (const file of message.event.removed) {
          entry.changed.delete(file)
          entry.removed.add(file)
        }
        clearTimeout(entry.changeTimer)
        entry.changeTimer = setTimeout(() => this._flushChanges(entry), this._options.changeDebounceMs ?? 150)
        break
      case 'reply': {
        const pending = entry.pending.get(message.id)
        if (!pending) break
        entry.pending.delete(message.id)
        if (message.ok) pending.resolve(message.value)
        else pending.reject(new Error(message.error))
        break
      }
      case 'log':
        this._options.log?.[message.level](`[vault-index] ${message.message}`)
        break
      case 'disposed':
        worker.kill()
        break
    }
  }

  private _onWorkerExit(entry: RootEntry, worker: IndexWorkerProcess, code: number): void {
    if (entry.worker !== worker) return
    entry.worker = null
    entry.ready = false
    for (const pending of entry.pending.values()) pending.reject(new Error('The vault index worker exited'))
    entry.pending.clear()
    if (entry.disposing || entry.windows.size === 0) return
    this._options.log?.error(`[vault-index] worker for "${entry.rootPath}" exited with code ${code}`)
    for (const windowId of entry.windows) {
      this._options.sendToWindow(windowId, 'mt::index::ready', { rootPath: entry.rootPath, ready: false })
    }
    if (entry.restarts < MAX_RESTARTS) {
      entry.restarts++
      this._startWorker(entry)
    }
  }

  private _call(entry: RootEntry, build: (id: number) => MainToWorkerMessage): Promise<unknown> {
    const worker = entry.worker
    if (!worker) return Promise.reject(new Error('The vault index worker is not running'))
    const id = entry.nextId++
    return new Promise((resolve, reject) => {
      entry.pending.set(id, { resolve, reject })
      worker.postMessage(build(id))
    })
  }

  private _queueFs(entry: RootEntry, change: VaultFsChange): void {
    entry.fsQueue.set(`${change.type}\0${change.path}`, change)
    if (entry.fsTimer) return
    entry.fsTimer = setTimeout(() => {
      entry.fsTimer = undefined
      const changes = [...entry.fsQueue.values()]
      entry.fsQueue.clear()
      entry.worker?.postMessage({ kind: 'fs', changes })
    }, this._options.fsBatchMs ?? 100)
  }

  private _flushChanges(entry: RootEntry): void {
    entry.changeTimer = undefined
    if (!entry.changed.size && !entry.removed.size) return
    const event: VaultChangeEvent = { changed: [...entry.changed].sort(), removed: [...entry.removed].sort() }
    entry.changed.clear()
    entry.removed.clear()
    for (const windowId of entry.windows) this._options.sendToWindow(windowId, 'mt::index::changed', event)
  }

  private _disposeEntry(entry: RootEntry): void {
    if (this._roots.get(entry.rootPath) !== entry) return
    this._roots.delete(entry.rootPath)
    entry.disposing = true
    clearTimeout(entry.fsTimer)
    clearTimeout(entry.changeTimer)
    clearTimeout(entry.disposeTimer)
    const worker = entry.worker
    if (!worker) return
    worker.postMessage({ kind: 'dispose' })
    // The worker exits itself after flushing its cache; this bounds a hung one.
    setTimeout(() => worker.kill(), 5000).unref?.()
  }
}
