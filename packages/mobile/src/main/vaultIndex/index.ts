// Vault index and full-text search of the Android main side. The desktop
// VaultIndexManager runs unchanged here and drives one Web Worker per open
// folder (indexWorker.ts) instead of an Electron utility process. The worker
// reads the vault through a file bridge served from the FileBackend, learns
// app-made changes from `fsChanged` and changes made by other apps from a
// rescan whenever the app returns to the foreground.

import type { VaultChangeEvent } from '@shared/plugins/types'
import type { VaultIndexReadyState } from '@shared/types/ipc'
import { VaultIndexManager, type IndexWorkerProcess } from '../../../../desktop/src/main/vaultIndex/manager'
import type { WorkerToMainMessage } from '../../../../desktop/src/main/vaultIndex/types'
import { USER_DATA_PATH } from '../boot'
import { walkEntries, walkFiles } from '../fs/backend'
import { EDITOR_WINDOW_ID, ipcMain, pushTo, type MobileIpcEvent } from '../ipc'
import { fsChanged, getBackend, getRootPath, rootChanged } from '../state'
import type {
  FsCall,
  HostToWorkerMessage,
  SearchEvent,
  SearchOptions,
  SearchRequest,
  WalkedFile,
  WorkerToHostMessage
} from './protocol'

export const VAULT_INDEX_CACHE_DIR = `${USER_DATA_PATH}/vault-index`

/** Native stats requested at once while a rescan walks the vault. */
const STAT_CONCURRENCY = 16

/** A running index worker as the main side sees it. */
export interface IndexWorkerPort {
  postMessage(message: HostToWorkerMessage): void
  onMessage(listener: (message: WorkerToHostMessage) => void): void
  /** An uncaught error inside the worker. */
  onError(listener: (message: string) => void): void
  terminate(): void
}

export type SpawnIndexWorker = () => IndexWorkerPort

const spawnWebWorker: SpawnIndexWorker = () => {
  const worker = new Worker(new URL('./indexWorker.ts', import.meta.url), { type: 'module', name: 'vault-index' })
  return {
    postMessage: (message) => worker.postMessage(message),
    onMessage: (listener) =>
      worker.addEventListener('message', (event: MessageEvent<WorkerToHostMessage>) => listener(event.data)),
    onError: (listener) => worker.addEventListener('error', (event) => listener(event.message)),
    terminate: () => worker.terminate()
  }
}

/** `<cacheDir>/<sha1(root)>.json`, named like desktop's caches. */
async function cacheFileFor(rootPath: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(rootPath))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${VAULT_INDEX_CACHE_DIR}/${hex}.json`
}

async function serveFsCall(call: FsCall): Promise<unknown> {
  const backend = getBackend()
  switch (call.op) {
    case 'stat': {
      const stats = await backend.stat(call.path).catch(() => null)
      // SAF reports no status-change time; creation time is the closest
      // meaning for `FileMetadata.ctimeMs` (Dataview's `file.ctime`).
      return stats && {
        isFile: stats.isFile,
        isDirectory: stats.isDirectory,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.birthtimeMs
      }
    }
    case 'walk':
      return walkFiles(backend, call.dir, () => true)
    case 'walkStats': {
      // Native listings carry size and mtime; stat only entries without them
      // (each stat is a storage-provider query).
      const files = await walkEntries(backend, call.dir, () => true)
      const out: WalkedFile[] = []
      const missing: string[] = []
      for (const { path, entry } of files) {
        if (entry.size !== undefined && entry.mtimeMs !== undefined) out.push({ path, mtimeMs: entry.mtimeMs, size: entry.size })
        else missing.push(path)
      }
      let next = 0
      const statNext = async(): Promise<void> => {
        while (next < missing.length) {
          const file = missing[next++]
          const stats = await backend.stat(file).catch(() => null)
          if (stats?.isFile) out.push({ path: file, mtimeMs: stats.mtimeMs, size: stats.size })
        }
      }
      await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, missing.length) }, statNext))
      return out
    }
    case 'readText':
      return backend.readText(call.path)
    case 'writeText':
      await backend.writeFile(call.path, call.text)
      return null
  }
}

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
}

/** Validates the renderer's `mt::rg::start` request, keeping the options Android honours. */
function toSearchRequest(value: unknown): SearchRequest {
  if (typeof value !== 'object' || value === null) throw new TypeError('search request must be an object')
  // Every field is checked below before it is used.
  const { searchId, mode, directories, pattern, options } = value as Partial<Record<keyof SearchRequest, unknown>>
  if (mode !== 'text' && mode !== 'files') throw new TypeError('mode must be "text" or "files"')
  if (!Array.isArray(directories) || !directories.every((dir) => typeof dir === 'string')) {
    throw new TypeError('directories must be a string array')
  }
  const raw: Partial<Record<keyof SearchOptions, unknown>> = typeof options === 'object' && options !== null ? options : {}
  const strings = (list: unknown): string[] | undefined =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : undefined
  const parsed: SearchOptions = {
    isRegexp: raw.isRegexp === true,
    isCaseSensitive: raw.isCaseSensitive === true,
    isWholeWord: raw.isWholeWord === true,
    maxFileSize: typeof raw.maxFileSize === 'number' || typeof raw.maxFileSize === 'string' ? raw.maxFileSize : null,
    inclusions: strings(raw.inclusions),
    exclusions: strings(raw.exclusions),
    maxResults: typeof raw.maxResults === 'number' ? raw.maxResults : undefined
  }
  return {
    searchId: requireString(searchId, 'searchId'),
    mode,
    directories,
    pattern: mode === 'files' ? '' : requireString(pattern, 'pattern'),
    options: parsed
  }
}

let manager: VaultIndexManager | null = null
let excludePatterns: string[] = []

/**
 * Applies the `treePathExcludePatterns` preference: the running index
 * re-scans and the next folder opens with it. Call on preference load and
 * whenever the preference changes.
 */
export function setVaultIndexExcludePatterns(patterns: readonly string[]): void {
  excludePatterns = [...patterns]
  manager?.setExcludePatterns(excludePatterns)
}

/** Registers `mt::index::*` and `mt::rg::*` and follows the open folder of the editor window. */
export function registerVaultIndex(spawn: SpawnIndexWorker = spawnWebWorker): void {
  const workers = new Map<string, IndexWorkerPort>()
  const searches = new Map<string, { worker: IndexWorkerPort; send: MobileIpcEvent['sender']['send'] }>()
  const cacheFiles = new Map<string, string>()
  let attachedRoot: string | null = null

  const deliverSearchEvent = (event: SearchEvent): void => {
    const search = searches.get(event.payload.searchId)
    if (!search) return
    if (event.channel !== 'match' && event.channel !== 'progress') searches.delete(event.payload.searchId)
    switch (event.channel) {
      case 'match':
        search.send('mt::rg::match', event.payload)
        break
      case 'progress':
        search.send('mt::rg::progress', event.payload)
        break
      case 'done':
        search.send('mt::rg::done', event.payload)
        break
      case 'cancelled':
        search.send('mt::rg::cancelled', event.payload)
        break
      case 'error':
        search.send('mt::rg::error', event.payload)
        break
    }
  }

  const spawnWorker = (rootPath: string): IndexWorkerProcess => {
    const worker = spawn()
    workers.set(rootPath, worker)
    const messageListeners: Array<(message: WorkerToMainMessage) => void> = []
    const exitListeners: Array<(code: number) => void> = []
    const forget = (): void => {
      worker.terminate()
      if (workers.get(rootPath) === worker) workers.delete(rootPath)
      for (const [searchId, search] of searches) {
        if (search.worker === worker) deliverSearchEvent({ channel: 'error', payload: { searchId, error: 'The vault index worker stopped' } })
      }
    }
    worker.onMessage((message) => {
      switch (message.kind) {
        case 'fs-call':
          serveFsCall(message.call).then(
            (value) => worker.postMessage({ kind: 'fs-reply', id: message.id, ok: true, value }),
            (error: unknown) =>
              worker.postMessage({
                kind: 'fs-reply',
                id: message.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
              })
          )
          break
        case 'search-event':
          deliverSearchEvent(message.event)
          break
        default:
          for (const listener of messageListeners) listener(message)
      }
    })
    // An error escaping the runtime leaves the index in an unknown state;
    // like a crashed utility process, the manager restarts it.
    worker.onError((message) => {
      console.error(`[vault-index] worker for "${rootPath}" failed: ${message}`)
      forget()
      for (const listener of exitListeners) listener(1)
    })
    return {
      postMessage: (message) => worker.postMessage(message),
      onMessage: (listener) => messageListeners.push(listener),
      onExit: (listener) => exitListeners.push(listener),
      kill: forget
    }
  }

  const current = new VaultIndexManager({
    getCacheFile: (rootPath) => cacheFiles.get(rootPath) ?? null,
    getExcludePatterns: () => excludePatterns,
    spawnWorker,
    sendToWindow: (windowId, channel, payload) => {
      // The manager pairs each channel with its payload type.
      if (channel === 'mt::index::ready') pushTo(windowId)(channel, payload as VaultIndexReadyState)
      else pushTo(windowId)(channel, payload as VaultChangeEvent)
    },
    log: console
  })
  manager = current

  const attach = async(rootPath: string | null): Promise<void> => {
    if (attachedRoot) current.detachWindow(EDITOR_WINDOW_ID, attachedRoot)
    attachedRoot = null
    if (!rootPath) return
    if (!cacheFiles.has(rootPath)) cacheFiles.set(rootPath, await cacheFileFor(rootPath))
    // Another folder was opened while hashing.
    if (getRootPath() !== rootPath) return
    attachedRoot = rootPath
    current.attachWindow(EDITOR_WINDOW_ID, rootPath)
  }

  rootChanged.on((rootPath) => {
    attach(rootPath).catch((error: unknown) => console.error('[vault-index] could not open the folder index', error))
  })
  fsChanged.on((change) => {
    if (!attachedRoot) return
    current.handleWatcherEvent({ type: change.type, windowId: EDITOR_WINDOW_ID, rootPath: attachedRoot, pathname: change.pathname })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !attachedRoot) return
    workers.get(attachedRoot)?.postMessage({ kind: 'rescan' })
  })

  ipcMain.handle('mt::index::is-ready', (event) => current.isReady(event.sender.id))
  ipcMain.handle('mt::index::get-file', (event, pathname: unknown) =>
    current.query(event.sender.id, 'getFile', [requireString(pathname, 'path')])
  )
  ipcMain.handle('mt::index::list-files', (event) => current.query(event.sender.id, 'listFiles', []))
  ipcMain.handle('mt::index::resolve-link', (event, target: unknown, sourcePath: unknown) =>
    current.query(event.sender.id, 'resolveLink', [requireString(target, 'target'), requireString(sourcePath, 'sourcePath')])
  )
  ipcMain.handle('mt::index::backlinks', (event, pathname: unknown) =>
    current.query(event.sender.id, 'getBacklinks', [requireString(pathname, 'path')])
  )
  ipcMain.handle('mt::index::tags', (event) => current.query(event.sender.id, 'getTags', []))
  ipcMain.handle('mt::index::files-with-tag', (event, tag: unknown, options: unknown) => {
    const includeNested =
      typeof options === 'object' && options !== null && 'includeNested' in options && options.includeNested === true
    return current.query(event.sender.id, 'getFilesWithTag', [requireString(tag, 'tag'), { includeNested }])
  })
  ipcMain.handle('mt::index::request', (event, type: unknown, payload: unknown) =>
    current.request(event.sender.id, requireString(type, 'type'), payload)
  )

  ipcMain.handle('mt::rg::start', (event, req: unknown) => {
    const request = toSearchRequest(req)
    const { searchId } = request
    const worker = attachedRoot && event.sender.id === EDITOR_WINDOW_ID ? workers.get(attachedRoot) : undefined
    if (!worker) {
      event.sender.send('mt::rg::error', { searchId, error: 'No folder is open' })
      return { searchId }
    }
    searches.set(searchId, { worker, send: event.sender.send })
    worker.postMessage({ kind: 'search', request })
    return { searchId }
  })
  ipcMain.on('mt::rg::cancel', (_event, searchId) => {
    searches.get(searchId)?.worker.postMessage({ kind: 'search-cancel', searchId })
  })
}
