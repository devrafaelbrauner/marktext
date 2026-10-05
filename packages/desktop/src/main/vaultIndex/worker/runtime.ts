import { loadVaultIndexCache, saveVaultIndexCache } from '../cache'
import type { MainToWorkerMessage, VaultIndexFs, VaultIndexQueries, WorkerToMainMessage } from '../types'
import { VaultIndex } from '../vaultIndex'
import { dispatchWorkerRequest } from './handlers'

/** Delay between the last index change and the cache write. */
const CACHE_WRITE_DELAY_MS = 2000

export interface IndexWorkerRuntimeOptions {
  /** Disk access for scanning, cache persistence and request handlers. */
  fs: VaultIndexFs
  cacheWriteDelayMs?: number
  /** Called after `dispose` flushed the cache; the entry exits the process. */
  onDisposed?: () => void
}

export interface IndexWorkerRuntime {
  handle(message: MainToWorkerMessage): void
}

/**
 * Message loop of the index utility process, independent of the transport
 * so it can run in-process in tests. Disk work (`init`, `fs`, `config`,
 * `dispose`) runs strictly in arrival order; queries and handler requests are
 * answered right away from the current in-memory state, which before `ready`
 * is empty (or, after `config`, the previous scan).
 */
export const createIndexWorkerRuntime = (
  post: (message: WorkerToMainMessage) => void,
  options: IndexWorkerRuntimeOptions
): IndexWorkerRuntime => {
  let index: VaultIndex | null = null
  let cacheFile: string | null = null
  let cacheTimer: NodeJS.Timeout | undefined
  let queue: Promise<void> = Promise.resolve()

  const log = (level: 'info' | 'warn' | 'error', message: string): void => post({ kind: 'log', level, message })

  const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      log('error', `Vault index task failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    })
  }

  const writeCache = async(): Promise<void> => {
    clearTimeout(cacheTimer)
    cacheTimer = undefined
    if (!index || !cacheFile) return
    try {
      await saveVaultIndexCache(options.fs, cacheFile, index.toCache())
    } catch (error) {
      log('warn', `Could not write the vault index cache: ${String(error)}`)
    }
  }

  const scheduleCacheWrite = (): void => {
    if (!cacheFile) return
    clearTimeout(cacheTimer)
    cacheTimer = setTimeout(() => enqueue(writeCache), options.cacheWriteDelayMs ?? CACHE_WRITE_DELAY_MS)
  }

  const runQuery = (method: keyof VaultIndexQueries, args: unknown[]): unknown => {
    if (!index) return method === 'getFile' || method === 'resolveLink' ? null : []
    switch (method) {
      case 'getFile':
        return index.getFile(String(args[0]))
      case 'listFiles':
        return index.listFiles()
      case 'resolveLink':
        return index.resolveLink(String(args[0]), String(args[1]))
      case 'getBacklinks':
        return index.getBacklinks(String(args[0]))
      case 'getTags':
        return index.getTags()
      case 'getFilesWithTag': {
        const options = args[1]
        const includeNested =
          typeof options === 'object' && options !== null && 'includeNested' in options && options.includeNested === true
        return index.getFilesWithTag(String(args[0]), { includeNested })
      }
    }
  }

  return {
    handle(message) {
      switch (message.kind) {
        case 'init': {
          const current = new VaultIndex(message.rootPath, options.fs, { excludePatterns: message.excludePatterns })
          index = current
          cacheFile = message.cacheFile
          enqueue(async() => {
            const cache = cacheFile ? await loadVaultIndexCache(options.fs, cacheFile) : null
            await current.scan(cache)
            post({ kind: 'ready' })
            scheduleCacheWrite()
          })
          break
        }
        case 'fs':
          enqueue(async() => {
            if (!index) return
            const event = await index.applyChanges(message.changes)
            if (event.changed.length || event.removed.length) {
              post({ kind: 'changed', event })
              scheduleCacheWrite()
            }
          })
          break
        case 'config':
          enqueue(async() => {
            if (!index) return
            const before = new Set(index.listFiles().map((file) => file.path))
            index.setExcludePatterns(message.excludePatterns)
            await index.scan(index.toCache())
            const after = index.listFiles().map((file) => file.path)
            const afterSet = new Set(after)
            post({
              kind: 'changed',
              event: { changed: after, removed: [...before].filter((file) => !afterSet.has(file)).sort() }
            })
            scheduleCacheWrite()
          })
          break
        case 'query':
          try {
            post({ kind: 'reply', id: message.id, ok: true, value: runQuery(message.method, message.args) })
          } catch (error) {
            post({ kind: 'reply', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          break
        case 'request': {
          const current = index
          if (!current) {
            post({ kind: 'reply', id: message.id, ok: false, error: 'The vault index is not initialized' })
            break
          }
          dispatchWorkerRequest(message.type, message.payload, { index: current, fs: options.fs }).then(
            (value) => post({ kind: 'reply', id: message.id, ok: true, value }),
            (error: unknown) =>
              post({ kind: 'reply', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
          )
          break
        }
        case 'dispose':
          enqueue(async() => {
            await writeCache()
            post({ kind: 'disposed' })
            options.onDisposed?.()
          })
          break
      }
    }
  }
}
