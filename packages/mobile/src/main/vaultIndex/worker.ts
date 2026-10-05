// Logic of the vault index Web Worker, independent of the transport so the
// tests run it in-process. It hosts the unchanged desktop index runtime over
// a file bridge to the main side, rescans on resume and answers searches.

import { posix as path } from 'pathe'
import type { VaultFileStats, VaultFsChange, VaultIndexFs } from '../../../../desktop/src/main/vaultIndex/types'
import { createIndexWorkerRuntime } from '../../../../desktop/src/main/vaultIndex/worker/runtime'
import type { FsCall, FsResults, HostToWorkerMessage, SearchRequest, TextMatch, WorkerToHostMessage } from './protocol'
import { createPathFilter, findTextMatches, parseMaxFileSize } from './search'

/** Files searched between two yields to the message loop, so a cancel gets through. */
const SEARCH_YIELD_EVERY = 25

interface CachedText {
  text: string
  mtimeMs: number
  size: number
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export interface IndexWorker {
  handle(message: HostToWorkerMessage): void
}

const isInside = (dir: string, file: string): boolean => file === dir || file.startsWith(dir.endsWith('/') ? dir : `${dir}/`)

export function createIndexWorker(post: (message: WorkerToHostMessage) => void): IndexWorker {
  const pending = new Map<number, PendingCall>()
  let nextCallId = 1

  // Executor form throughout: the ES2022 lib of this package predates Promise.withResolvers.
  const call = <K extends FsCall['op']>(fsCall: Extract<FsCall, { op: K }>): Promise<FsResults[K]> =>
    new Promise((resolve, reject) => {
      const id = nextCallId++
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      post({ kind: 'fs-call', id, call: fsCall })
    })

  // Note texts the index read, keyed by path with the stat seen just before
  // the read, so a search re-reads only notes that changed since.
  const lastStats = new Map<string, VaultFileStats>()
  const texts = new Map<string, CachedText>()

  const fs: VaultIndexFs = {
    async stat(file) {
      const stats = await call({ op: 'stat', path: file }).catch(() => null)
      if (stats) lastStats.set(file, stats)
      else lastStats.delete(file)
      return stats
    },
    async walk(dir, isIgnored) {
      // The main side already skips hidden folders and node_modules; the
      // rest of the ignore rules (exclude patterns) apply per path here.
      const files = await call({ op: 'walk', dir }).catch(() => [])
      return files.filter((file) => !isIgnored(file))
    },
    async readText(file) {
      const text = await call({ op: 'readText', path: file })
      const stats = lastStats.get(file)
      if (stats) texts.set(file, { text, mtimeMs: stats.mtimeMs, size: stats.size })
      return text
    },
    async writeText(file, text) {
      await call({ op: 'writeText', path: file, text })
    }
  }

  let markReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    markReady = resolve
  })
  const runtime = createIndexWorkerRuntime(
    (message) => {
      if (message.kind === 'ready') markReady()
      post(message)
    },
    { fs }
  )

  const textOf = async(file: string, mtimeMs: number, size: number): Promise<string> => {
    const cached = texts.get(file)
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.text
    const text = await call({ op: 'readText', path: file })
    texts.set(file, { text, mtimeMs, size })
    return text
  }

  // Compares the folder on disk with the index; the index re-reads whatever
  // differs (applyChanges trusts the disk, so a spurious entry is harmless).
  const rescan = async(): Promise<void> => {
    await ready
    const index = runtime.index
    if (!index) return
    const known = new Map<string, { mtimeMs: number; size: number }>()
    for (const entry of [...index.listFiles(), ...index.listAssets()]) known.set(entry.path, entry)
    const changes: VaultFsChange[] = []
    for (const file of await call({ op: 'walkStats', dir: index.rootPath })) {
      const entry = known.get(file.path)
      known.delete(file.path)
      if (!entry) changes.push({ type: 'add', path: file.path })
      else if (entry.mtimeMs !== file.mtimeMs || entry.size !== file.size) changes.push({ type: 'change', path: file.path })
    }
    for (const file of known.keys()) changes.push({ type: 'unlink', path: file })
    if (changes.length > 0) runtime.handle({ kind: 'fs', changes })
  }

  const searches = new Map<string, { cancelled: boolean }>()

  const search = async(request: SearchRequest): Promise<void> => {
    const { searchId, mode, directories, pattern, options } = request
    const state = { cancelled: false }
    searches.set(searchId, state)
    try {
      await ready
      const index = runtime.index
      if (state.cancelled || !index) return
      for (const dir of directories) {
        if (!isInside(index.rootPath, dir)) throw new Error(`"${dir}" is outside the open folder`)
      }
      const filters = directories.map((dir) => createPathFilter(dir, options))
      const entries = mode === 'text' ? index.listFiles() : [...index.listFiles(), ...index.listAssets()]
      const maxFileSize = mode === 'text' ? parseMaxFileSize(options.maxFileSize) : null
      const maxResults = typeof options.maxResults === 'number' && options.maxResults > 0 ? options.maxResults : Infinity
      const candidates = entries
        .filter((entry) => filters.some((accepts) => accepts(entry.path)) && (maxFileSize === null || entry.size <= maxFileSize))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

      let found = 0
      for (let i = 0; i < candidates.length && found < maxResults; i++) {
        if (i % SEARCH_YIELD_EVERY === SEARCH_YIELD_EVERY - 1) await new Promise((resolve) => setTimeout(resolve, 0))
        if (state.cancelled) return
        const entry = candidates[i]
        let payload: { filePath: string; matches: TextMatch[] } | string = entry.path
        if (mode === 'text') {
          let text: string
          try {
            text = await textOf(entry.path, entry.mtimeMs, entry.size)
          } catch {
            // Deleted or revoked since the index saw it, like ripgrep skipping an unreadable file.
            continue
          }
          if (state.cancelled) return
          const matches = findTextMatches(text, pattern, options)
          if (matches.length === 0) continue
          payload = { filePath: entry.path, matches }
        }
        found++
        post({ kind: 'search-event', event: { channel: 'progress', payload: { searchId, num: found } } })
        post({ kind: 'search-event', event: { channel: 'match', payload: { searchId, payload } } })
      }
      if (!state.cancelled) post({ kind: 'search-event', event: { channel: 'done', payload: { searchId } } })
    } catch (error) {
      if (!state.cancelled) {
        const message = error instanceof Error ? error.message : String(error)
        post({ kind: 'search-event', event: { channel: 'error', payload: { searchId, error: message } } })
      }
    } finally {
      if (searches.get(searchId) === state) searches.delete(searchId)
    }
  }

  return {
    handle(message) {
      switch (message.kind) {
        case 'fs-reply': {
          const entry = pending.get(message.id)
          if (!entry) break
          pending.delete(message.id)
          if (message.ok) entry.resolve(message.value)
          else entry.reject(new Error(message.error))
          break
        }
        case 'rescan':
          rescan().catch((error: unknown) => post({ kind: 'log', level: 'warn', message: `Vault rescan failed: ${String(error)}` }))
          break
        case 'search':
          // Reports its own failures as `mt::rg::error`.
          search(message.request)
          break
        case 'search-cancel': {
          const state = searches.get(message.searchId)
          if (!state) break
          state.cancelled = true
          searches.delete(message.searchId)
          post({ kind: 'search-event', event: { channel: 'cancelled', payload: { searchId: message.searchId } } })
          break
        }
        case 'fs':
          for (const change of message.changes) {
            if (change.type !== 'unlink' && change.type !== 'unlinkDir') continue
            const prefix = `${path.normalize(change.path)}/`
            for (const file of [...texts.keys()]) {
              if (file === change.path || file.startsWith(prefix)) texts.delete(file)
            }
          }
          runtime.handle(message)
          break
        default:
          runtime.handle(message)
      }
    }
  }
}
