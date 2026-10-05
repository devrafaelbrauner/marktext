// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchWorkerRequest, registerWorkerHandler } from 'main_renderer/vaultIndex/worker/handlers'
import { createIndexWorkerRuntime } from 'main_renderer/vaultIndex/worker/runtime'
import { VaultIndexManager, type IndexWorkerProcess } from 'main_renderer/vaultIndex/manager'
import { getVaultIndexCacheFile } from 'main_renderer/vaultIndex/cacheFile'
import type { MainToWorkerMessage, VaultIndexReader, WorkerToMainMessage } from 'main_renderer/vaultIndex/types'
import { nodeVaultIndexFs } from 'main_renderer/vaultIndex/nodeFs'

const FIXTURE = path.resolve(__dirname, '../../fixtures/vault')
const emptyReader = {} as VaultIndexReader

describe('worker handler registry', () => {
  it('dispatches to the registered handler with the index in the context', async() => {
    const registration = registerWorkerHandler('spec.echo', (payload, { index }) => ({ payload, root: index.rootPath }))
    try {
      const reader = { rootPath: '/vault' } as VaultIndexReader
      await expect(dispatchWorkerRequest('spec.echo', { a: 1 }, { index: reader, fs: nodeVaultIndexFs })).resolves.toEqual({
        payload: { a: 1 },
        root: '/vault'
      })
    } finally {
      registration.dispose()
    }
  })

  it('awaits async handlers and propagates their failures', async() => {
    const ok = registerWorkerHandler('spec.async', async() => 'done')
    const bad = registerWorkerHandler('spec.fail', () => {
      throw new Error('bad payload')
    })
    try {
      await expect(dispatchWorkerRequest('spec.async', null, { index: emptyReader, fs: nodeVaultIndexFs })).resolves.toBe('done')
      await expect(dispatchWorkerRequest('spec.fail', null, { index: emptyReader, fs: nodeVaultIndexFs })).rejects.toThrow('bad payload')
    } finally {
      ok.dispose()
      bad.dispose()
    }
  })

  it('rejects unknown, empty and duplicate types', async() => {
    await expect(dispatchWorkerRequest('spec.none', null, { index: emptyReader, fs: nodeVaultIndexFs })).rejects.toThrow(
      'No vault index handler registered for "spec.none"'
    )
    expect(() => registerWorkerHandler('', () => null)).toThrow()
    const first = registerWorkerHandler('spec.dup', () => 1)
    expect(() => registerWorkerHandler('spec.dup', () => 2)).toThrow('already registered')
    first.dispose()
    await expect(dispatchWorkerRequest('spec.dup', null, { index: emptyReader, fs: nodeVaultIndexFs })).rejects.toThrow()
  })

  it('disposing a stale registration keeps the newer handler of the same type', async() => {
    const first = registerWorkerHandler('spec.swap', () => 'first')
    first.dispose()
    const second = registerWorkerHandler('spec.swap', () => 'second')
    first.dispose()
    try {
      await expect(dispatchWorkerRequest('spec.swap', null, { index: emptyReader, fs: nodeVaultIndexFs })).resolves.toBe('second')
    } finally {
      second.dispose()
    }
  })
})

/** Runs the worker runtime in-process behind a structured-clone boundary, like a utility process. */
const createInProcessWorker = (): IndexWorkerProcess & { exit(code: number): void; received: MainToWorkerMessage[] } => {
  const messageListeners: Array<(message: WorkerToMainMessage) => void> = []
  const exitListeners: Array<(code: number) => void> = []
  let alive = true
  const exit = (code: number): void => {
    if (!alive) return
    alive = false
    for (const listener of exitListeners) listener(code)
  }
  const runtime = createIndexWorkerRuntime(
    (message) => {
      const copy = structuredClone(message)
      setTimeout(() => {
        if (alive) for (const listener of messageListeners) listener(copy)
      }, 0)
    },
    { fs: nodeVaultIndexFs, cacheWriteDelayMs: 5, onDisposed: () => setTimeout(() => exit(0), 0) }
  )
  const received: MainToWorkerMessage[] = []
  return {
    received,
    postMessage: (message) => {
      received.push(message)
      const copy = structuredClone(message)
      setTimeout(() => alive && runtime.handle(copy), 0)
    },
    onMessage: (listener) => messageListeners.push(listener),
    onExit: (listener) => exitListeners.push(listener),
    kill: () => exit(0),
    exit
  }
}

describe('index worker runtime', () => {
  let root: string
  let cacheDir: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-worker-'))
    fs.cpSync(FIXTURE, root, { recursive: true })
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-worker-cache-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  it('scans on init, answers queries and handler requests, applies fs changes and flushes the cache on dispose', async() => {
    const posted: WorkerToMainMessage[] = []
    const disposed = vi.fn()
    const runtime = createIndexWorkerRuntime((message) => posted.push(structuredClone(message)), {
      fs: nodeVaultIndexFs,
      cacheWriteDelayMs: 60_000,
      onDisposed: disposed
    })
    const cacheFile = path.join(cacheDir, 'index.json')
    const handler = registerWorkerHandler('spec.countTasks', (checked, { index }) =>
      index.listFiles().flatMap((file) => file.tasks.filter((task) => task.checked === checked)).length
    )
    try {
      runtime.handle({ kind: 'init', rootPath: root, cacheFile, excludePatterns: [] })
      await vi.waitFor(() => expect(posted).toContainEqual({ kind: 'ready' }))

      runtime.handle({ kind: 'query', id: 1, method: 'getFilesWithTag', args: ['daily'] })
      runtime.handle({ kind: 'request', id: 2, type: 'spec.countTasks', payload: false })
      runtime.handle({ kind: 'request', id: 3, type: 'spec.unknown', payload: null })
      await vi.waitFor(() => expect(posted.filter((message) => message.kind === 'reply')).toHaveLength(3))
      const replies = Object.fromEntries(
        posted.flatMap((message) => (message.kind === 'reply' ? [[message.id, message]] : []))
      )
      expect(replies[1]).toEqual({
        kind: 'reply',
        id: 1,
        ok: true,
        value: ['2026-10-01', '2026-10-02', '2026-10-03'].map((day) => path.join(root, 'Daily', `${day}.md`))
      })
      expect(replies[2]).toMatchObject({ ok: true, value: 12 })
      expect(replies[3]).toMatchObject({ ok: false, error: 'No vault index handler registered for "spec.unknown"' })

      fs.writeFileSync(path.join(root, 'Fresh.md'), '#fresh\n')
      runtime.handle({ kind: 'fs', changes: [{ type: 'add', path: path.join(root, 'Fresh.md') }] })
      await vi.waitFor(() =>
        expect(posted).toContainEqual({ kind: 'changed', event: { changed: [path.join(root, 'Fresh.md')], removed: [] } })
      )

      runtime.handle({ kind: 'dispose' })
      await vi.waitFor(() => expect(disposed).toHaveBeenCalled())
      expect(posted.at(-1)).toEqual({ kind: 'disposed' })
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      expect(cache.rootPath).toBe(root)
      expect(cache.notes.map((note: { meta: { path: string } }) => note.meta.path)).toContain(path.join(root, 'Fresh.md'))
    } finally {
      handler.dispose()
    }
  })

  it('re-scans with new exclude patterns and reports removed notes', async() => {
    const posted: WorkerToMainMessage[] = []
    const runtime = createIndexWorkerRuntime((message) => posted.push(message), { fs: nodeVaultIndexFs })
    runtime.handle({ kind: 'init', rootPath: root, cacheFile: null, excludePatterns: [] })
    await vi.waitFor(() => expect(posted).toContainEqual({ kind: 'ready' }))
    runtime.handle({ kind: 'config', excludePatterns: ['Daily'] })
    await vi.waitFor(() => expect(posted.some((message) => message.kind === 'changed')).toBe(true))
    const changed = posted.find((message) => message.kind === 'changed')
    expect(changed?.kind === 'changed' && changed.event.removed).toEqual(
      ['2026-10-01', '2026-10-02', '2026-10-03'].map((day) => path.join(root, 'Daily', `${day}.md`))
    )
  })
})

describe('VaultIndexManager', () => {
  let root: string
  let cacheDir: string
  let workers: Array<ReturnType<typeof createInProcessWorker>>
  let sent: Array<{ windowId: number; channel: string; payload: unknown }>
  let manager: VaultIndexManager

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-manager-'))
    fs.cpSync(FIXTURE, root, { recursive: true })
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-manager-cache-'))
    workers = []
    sent = []
    manager = new VaultIndexManager({
      getCacheFile: (rootPath) => getVaultIndexCacheFile(cacheDir, rootPath),
      getExcludePatterns: () => [],
      spawnWorker: () => {
        const worker = createInProcessWorker()
        workers.push(worker)
        return worker
      },
      sendToWindow: (windowId, channel, payload) => sent.push({ windowId, channel, payload }),
      fsBatchMs: 5,
      changeDebounceMs: 5,
      idleDisposeMs: 10
    })
  })

  afterEach(() => {
    manager.dispose()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  const readyPushes = (windowId: number): unknown[] =>
    sent.filter((entry) => entry.windowId === windowId && entry.channel === 'mt::index::ready').map((entry) => entry.payload)

  it('shares one worker between windows of the same root and announces readiness to each', async() => {
    manager.handleWatcherEvent({ type: 'watch', windowId: 1, rootPath: root })
    manager.handleWatcherEvent({ type: 'watch', windowId: 2, rootPath: `${root}${path.sep}` })
    expect(workers).toHaveLength(1)
    expect(readyPushes(1)).toEqual([{ rootPath: root, ready: false }])

    await vi.waitFor(() => expect(manager.isReady(2)).toBe(true))
    expect(readyPushes(1)).toEqual([{ rootPath: root, ready: false }, { rootPath: root, ready: true }])
    expect(readyPushes(2)).toEqual([{ rootPath: root, ready: false }, { rootPath: root, ready: true }])

    const tags = await manager.query(2, 'getFilesWithTag', ['project', { includeNested: true }])
    expect(tags).toEqual([path.join(root, 'Projects', 'Alpha.md'), path.join(root, 'Projects', 'Beta.md')])

    // A third window opening the root later is told right away.
    manager.attachWindow(3, root)
    expect(readyPushes(3)).toEqual([{ rootPath: root, ready: true }])
  })

  it('answers empty results for windows without an opened folder', async() => {
    await expect(manager.query(9, 'getFile', [path.join(root, 'Home.md')])).resolves.toBeNull()
    await expect(manager.query(9, 'listFiles', [])).resolves.toEqual([])
    await expect(manager.query(9, 'getTags', [])).resolves.toEqual([])
    await expect(manager.request(9, 'spec.any', null)).resolves.toBeNull()
    expect(manager.isReady(9)).toBe(false)
    expect(workers).toHaveLength(0)
  })

  it('coalesces watcher events of all windows into one batch and one change push per window', async() => {
    manager.attachWindow(1, root)
    manager.attachWindow(2, root)
    await vi.waitFor(() => expect(manager.isReady(1)).toBe(true))
    const file = path.join(root, 'Ideas.md')
    fs.appendFileSync(file, '\n#late\n')
    manager.handleWatcherEvent({ type: 'change', windowId: 1, rootPath: root, pathname: file })
    manager.handleWatcherEvent({ type: 'change', windowId: 2, rootPath: root, pathname: file })

    await vi.waitFor(() => expect(sent.filter((entry) => entry.channel === 'mt::index::changed')).toHaveLength(2))
    expect(workers[0].received.filter((message) => message.kind === 'fs')).toEqual([
      { kind: 'fs', changes: [{ type: 'change', path: file }] }
    ])
    expect(sent.filter((entry) => entry.channel === 'mt::index::changed')).toEqual([
      { windowId: 1, channel: 'mt::index::changed', payload: { changed: [file], removed: [] } },
      { windowId: 2, channel: 'mt::index::changed', payload: { changed: [file], removed: [] } }
    ])
    await expect(manager.query(1, 'getFilesWithTag', ['late'])).resolves.toEqual([file])
  })

  it('re-indexes on save and rename notifications inside the root only', async() => {
    manager.attachWindow(1, root)
    await vi.waitFor(() => expect(manager.isReady(1)).toBe(true))
    const oldPath = path.join(root, 'Notes.md')
    const newPath = path.join(root, 'Renamed.md')
    fs.renameSync(oldPath, newPath)
    manager.notifyRenamed(newPath, oldPath)
    manager.notifySaved(path.join(os.tmpdir(), 'elsewhere.md'))
    await vi.waitFor(async() => expect(await manager.query(1, 'getFile', [newPath])).not.toBeNull())
    await expect(manager.query(1, 'getFile', [oldPath])).resolves.toBeNull()
    expect(workers[0].received.filter((message) => message.kind === 'fs')).toEqual([
      { kind: 'fs', changes: [{ type: 'unlink', path: oldPath }, { type: 'add', path: newPath }] }
    ])
  })

  it('stops the worker after the last window left, keeping the cache for the next start', async() => {
    manager.attachWindow(1, root)
    await vi.waitFor(() => expect(manager.isReady(1)).toBe(true))
    manager.handleWatcherEvent({ type: 'unwatch', windowId: 1, rootPath: root })
    expect(readyPushes(1).at(-1)).toEqual({ rootPath: null, ready: false })
    await expect(manager.query(1, 'listFiles', [])).resolves.toEqual([])

    await vi.waitFor(() => expect(fs.existsSync(getVaultIndexCacheFile(cacheDir, root))).toBe(true))
    await vi.waitFor(() => expect(workers[0].received.at(-1)).toEqual({ kind: 'dispose' }))

    manager.attachWindow(1, root)
    expect(workers).toHaveLength(2)
    await vi.waitFor(() => expect(manager.isReady(1)).toBe(true))
  })

  it('switching a window to another root detaches it from the first', async() => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-manager-other-'))
    try {
      fs.writeFileSync(path.join(other, 'Only.md'), '# Only\n')
      manager.attachWindow(1, root)
      manager.attachWindow(1, other)
      expect(manager.getRootPath(1)).toBe(path.resolve(other))
      await vi.waitFor(() => expect(manager.isReady(1)).toBe(true))
      await expect(manager.query(1, 'listFiles', [])).resolves.toMatchObject([{ path: path.join(path.resolve(other), 'Only.md') }])
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })

  it('rejects pending calls and restarts the worker when it crashes', async() => {
    manager.attachWindow(1, root)
    await vi.waitFor(() => expect(manager.isReady(1)).toBe(true))
    const handler = registerWorkerHandler('spec.never', () => new Promise(() => {}))
    try {
      const pending = manager.request(1, 'spec.never', null)
      workers[0].exit(1)
      await expect(pending).rejects.toThrow('The vault index worker exited')
      expect(readyPushes(1).at(-1)).toEqual({ rootPath: root, ready: false })
      expect(workers).toHaveLength(2)
      await vi.waitFor(() => expect(manager.isReady(1)).toBe(true))
    } finally {
      handler.dispose()
    }
  })
})
