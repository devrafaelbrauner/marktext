// `mt::vault::*` file access for plugins over the FileBackend, with the
// semantics of desktop `main/plugins/vaultFs.ts`: absolute paths scoped to
// the open folder (or the folder of the active file), 'CONFLICT' on a stale
// `expectedMtimeMs`, and the same read and listing caps. SAF trees have no
// symlinks, so the scope check is a lexical containment test.

import { posix } from 'pathe'
import type { VaultFileEntry } from '@shared/plugins/types'
import { PluginError } from '../../../../desktop/src/main/plugins/errors'
import { isMobileFsError, walkEntries, type FileBackend, type FileStat } from '../fs/backend'
import { fsChanged } from '../state'

/** Hard cap of `readBinary`, in bytes; callers may only lower it (desktop vaultFs value). */
export const MAX_BINARY_READ_BYTES = 64 * 1024 * 1024
/** `list` returns at most this many files (desktop vaultFs value). */
export const MAX_LIST_ENTRIES = 50_000

interface Resolved {
  path: string
  stat: FileStat | null
}

const isInside = (root: string, candidate: string): boolean => {
  const relative = posix.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !posix.isAbsolute(relative))
}

/** Maps a revoked grant onto the plugin error a caller can show. */
const permissionAware = async<T>(task: () => Promise<T>): Promise<T> => {
  try {
    return await task()
  } catch (err) {
    if (isMobileFsError(err, 'PERMISSION_DENIED')) throw new PluginError('PERMISSION_DENIED', err.message)
    throw err
  }
}

export class VaultFiles {
  constructor(
    private readonly backend: FileBackend,
    /** Open folder, else the folder of the active file, else null. */
    private readonly root: () => string | null
  ) {}

  private async resolve(target: unknown): Promise<Resolved> {
    const root = this.root()
    if (!root || typeof target !== 'string' || !target || !posix.isAbsolute(target)) {
      throw new PluginError('OUTSIDE_VAULT', `"${String(target)}" is outside the opened folder`)
    }
    const normalized = posix.resolve(target)
    if (!isInside(posix.resolve(root), normalized)) {
      throw new PluginError('OUTSIDE_VAULT', `"${target}" is outside the opened folder`)
    }
    const rootStat = await this.backend.stat(root)
    if (!rootStat?.isDirectory) throw new PluginError('NOT_FOUND', 'The opened folder no longer exists')
    return { path: normalized, stat: await this.backend.stat(normalized) }
  }

  private static requireFile(resolved: Resolved): FileStat {
    if (!resolved.stat) throw new PluginError('NOT_FOUND', `"${resolved.path}" does not exist`)
    if (!resolved.stat.isFile) throw new PluginError('NOT_FOUND', `"${resolved.path}" is not a file`)
    return resolved.stat
  }

  readText(target: unknown): Promise<{ content: string; mtimeMs: number }> {
    return permissionAware(async() => {
      const resolved = await this.resolve(target)
      const stat = VaultFiles.requireFile(resolved)
      return { content: await this.backend.readText(resolved.path), mtimeMs: stat.mtimeMs }
    })
  }

  /** Reads a file of at most `maxBytes` (capped at `MAX_BINARY_READ_BYTES`); larger files reject with 'TOO_LARGE'. */
  readBinary(target: unknown, maxBytes?: unknown): Promise<Uint8Array> {
    return permissionAware(async() => {
      const resolved = await this.resolve(target)
      const limit =
        typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes >= 0
          ? Math.min(maxBytes, MAX_BINARY_READ_BYTES)
          : MAX_BINARY_READ_BYTES
      const stat = VaultFiles.requireFile(resolved)
      const tooLarge = new PluginError('TOO_LARGE', `"${resolved.path}" is larger than ${limit} bytes`)
      if (stat.size > limit) throw tooLarge
      const data = await this.backend.readFile(resolved.path)
      // The file may have grown between stat and read.
      if (data.byteLength > limit) throw tooLarge
      return data
    })
  }

  /**
   * Writes UTF-8 text (atomically where the provider allows). With
   * `expectedMtimeMs`, rejects with 'CONFLICT' when the file's current mtime
   * differs. A new file is created only when its folder exists.
   */
  writeText(target: unknown, content: unknown, expectedMtimeMs?: unknown): Promise<{ mtimeMs: number }> {
    return permissionAware(async() => {
      if (typeof content !== 'string') throw new PluginError('FAILED', 'Content must be a string')
      const resolved = await this.resolve(target)
      if (expectedMtimeMs !== undefined && expectedMtimeMs !== null) {
        const current = resolved.stat ? VaultFiles.requireFile(resolved).mtimeMs : null
        if (current !== expectedMtimeMs) throw new PluginError('CONFLICT', `"${resolved.path}" changed on disk`)
      } else if (resolved.stat) {
        VaultFiles.requireFile(resolved)
      }
      if (!resolved.stat) {
        const folder = await this.backend.stat(posix.dirname(resolved.path))
        if (!folder?.isDirectory) {
          throw new PluginError('NOT_FOUND', `The folder of "${resolved.path}" does not exist`)
        }
      }
      await this.backend.writeFile(resolved.path, content)
      const written = await this.backend.stat(resolved.path)
      const mtimeMs = written?.mtimeMs ?? Date.now()
      fsChanged.emit({ type: resolved.stat ? 'change' : 'add', pathname: resolved.path, mtimeMs })
      return { mtimeMs }
    })
  }

  /** Creates a new file and its missing folders; rejects with 'EXISTS' when anything exists at `target`. */
  createText(target: unknown, content: unknown): Promise<null> {
    return permissionAware(async() => {
      if (typeof content !== 'string') throw new PluginError('FAILED', 'Content must be a string')
      const resolved = await this.resolve(target)
      if (resolved.stat) throw new PluginError('EXISTS', `"${resolved.path}" already exists`)
      const missingDirs: string[] = []
      for (let dir = posix.dirname(resolved.path); !(await this.backend.stat(dir)); dir = posix.dirname(dir)) {
        missingDirs.unshift(dir)
      }
      await this.backend.mkdirp(posix.dirname(resolved.path))
      await this.backend.writeFile(resolved.path, content)
      for (const dir of missingDirs) fsChanged.emit({ type: 'addDir', pathname: dir })
      const written = await this.backend.stat(resolved.path)
      fsChanged.emit({ type: 'add', pathname: resolved.path, mtimeMs: written?.mtimeMs ?? Date.now() })
      return null
    })
  }

  exists(target: unknown): Promise<boolean> {
    return permissionAware(async() => (await this.resolve(target)).stat !== null)
  }

  /**
   * Files below the vault root, skipping hidden entries and `node_modules`.
   * `extensions` (lower-case, without the dot) filters by extension.
   */
  list(extensions?: unknown): Promise<VaultFileEntry[]> {
    return permissionAware(async() => {
      const root = this.root()
      if (!root) return []
      const wanted = Array.isArray(extensions)
        ? new Set(extensions.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase()))
        : null
      const extensionOf = (path: string): string => posix.extname(path).slice(1).toLowerCase()
      const files = await walkEntries(this.backend, posix.resolve(root), (path) =>
        !posix.basename(path).startsWith('.') && (!wanted || wanted.has(extensionOf(path)))
      )
      const result: VaultFileEntry[] = []
      for (const { path, entry } of files) {
        if (result.length >= MAX_LIST_ENTRIES) break
        // Native listings carry size and mtime; a stat per file costs a
        // storage-provider query each (seconds on a large vault).
        let { size, mtimeMs } = entry
        if (size === undefined || mtimeMs === undefined) {
          const stat = await this.backend.stat(path)
          if (!stat?.isFile) continue
          ;({ size, mtimeMs } = stat)
        }
        result.push({ path, name: posix.basename(path), extension: extensionOf(path), size, mtimeMs })
      }
      return result
    })
  }
}
