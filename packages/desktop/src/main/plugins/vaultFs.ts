import fs from 'fs/promises'
import path from 'path'
import writeFileAtomic from 'write-file-atomic'
import type { VaultFileEntry } from '@shared/plugins/types'
import { PluginError } from './errors'

/** Hard cap of `readBinary`, in bytes; callers may only lower it. */
export const MAX_BINARY_READ_BYTES = 64 * 1024 * 1024
/** `list` stops after this many files so a huge folder cannot stall the main process. */
export const MAX_LIST_ENTRIES = 50_000

const isErrno = (err: unknown, code: string): boolean =>
  (err as NodeJS.ErrnoException | null)?.code === code

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const outside = (target: string): PluginError =>
  new PluginError('OUTSIDE_VAULT', `"${target}" is outside the opened folder`)

const lstatOrNull = async(target: string) => {
  try {
    return await fs.lstat(target)
  } catch (err) {
    if (isErrno(err, 'ENOENT') || isErrno(err, 'ENOTDIR')) return null
    throw err
  }
}

/**
 * Resolves `target` for an operation scoped to `root`. The path must be
 * absolute and, once symlinks are resolved, lie inside the real path of
 * `root`. For a path that does not exist yet, the nearest existing ancestor
 * is resolved instead, so a missing file below a symlinked folder that points
 * outside is rejected too. A dangling symlink is rejected because writing
 * through it would create its target wherever it points.
 *
 * @returns the normalized absolute path (not the real path) and whether it exists.
 */
export const resolveInVault = async(
  root: string | null,
  target: unknown
): Promise<{ path: string; exists: boolean }> => {
  if (!root || typeof target !== 'string' || !target || !path.isAbsolute(target)) {
    throw outside(String(target))
  }
  const normalized = path.resolve(target)
  const realRoot = await fs.realpath(root).catch(() => {
    throw new PluginError('NOT_FOUND', 'The opened folder no longer exists')
  })

  let probe = normalized
  let exists = true
  for (;;) {
    const stat = await lstatOrNull(probe)
    if (stat) {
      const realProbe = await fs.realpath(probe).catch(() => null)
      if (!realProbe || !isInside(realRoot, realProbe)) throw outside(target)
      break
    }
    exists = false
    const parent = path.dirname(probe)
    if (parent === probe) throw outside(target)
    probe = parent
  }
  return { path: normalized, exists }
}

const statFile = async(target: string) => {
  const stat = await fs.stat(target)
  if (!stat.isFile()) throw new PluginError('NOT_FOUND', `"${target}" is not a file`)
  return stat
}

export const readText = async(
  root: string | null,
  target: unknown
): Promise<{ content: string; mtimeMs: number }> => {
  const resolved = await resolveInVault(root, target)
  if (!resolved.exists) throw new PluginError('NOT_FOUND', `"${resolved.path}" does not exist`)
  const stat = await statFile(resolved.path)
  const content = await fs.readFile(resolved.path, 'utf8')
  return { content, mtimeMs: stat.mtimeMs }
}

/** Reads a file of at most `maxBytes` (capped at `MAX_BINARY_READ_BYTES`); larger files reject with 'TOO_LARGE'. */
export const readBinary = async(
  root: string | null,
  target: unknown,
  maxBytes?: unknown
): Promise<Uint8Array> => {
  const resolved = await resolveInVault(root, target)
  if (!resolved.exists) throw new PluginError('NOT_FOUND', `"${resolved.path}" does not exist`)
  const limit =
    typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes >= 0
      ? Math.min(maxBytes, MAX_BINARY_READ_BYTES)
      : MAX_BINARY_READ_BYTES
  const stat = await statFile(resolved.path)
  if (stat.size > limit) {
    throw new PluginError('TOO_LARGE', `"${resolved.path}" is larger than ${limit} bytes`)
  }
  const buffer = await fs.readFile(resolved.path)
  // The file may have grown between stat and read.
  if (buffer.byteLength > limit) {
    throw new PluginError('TOO_LARGE', `"${resolved.path}" is larger than ${limit} bytes`)
  }
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/**
 * Atomically writes UTF-8 text. With `expectedMtimeMs`, rejects with
 * 'CONFLICT' when the file's current mtime differs (it changed or was deleted
 * since the caller read it). A new file is created only when its folder exists.
 */
export const writeText = async(
  root: string | null,
  target: unknown,
  content: unknown,
  expectedMtimeMs?: unknown
): Promise<{ mtimeMs: number }> => {
  if (typeof content !== 'string') throw new PluginError('FAILED', 'Content must be a string')
  const resolved = await resolveInVault(root, target)
  if (expectedMtimeMs !== undefined && expectedMtimeMs !== null) {
    const current = resolved.exists ? (await statFile(resolved.path)).mtimeMs : null
    if (current !== expectedMtimeMs) {
      throw new PluginError('CONFLICT', `"${resolved.path}" changed on disk`)
    }
  } else if (resolved.exists) {
    await statFile(resolved.path)
  }
  try {
    await writeFileAtomic(resolved.path, content, { encoding: 'utf8' })
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      throw new PluginError('NOT_FOUND', `The folder of "${resolved.path}" does not exist`)
    }
    throw err
  }
  return { mtimeMs: (await fs.stat(resolved.path)).mtimeMs }
}

/** Creates a new file and its missing folders; rejects with 'EXISTS' when anything exists at `target`. */
export const createText = async(
  root: string | null,
  target: unknown,
  content: unknown
): Promise<void> => {
  if (typeof content !== 'string') throw new PluginError('FAILED', 'Content must be a string')
  const resolved = await resolveInVault(root, target)
  if (resolved.exists) throw new PluginError('EXISTS', `"${resolved.path}" already exists`)
  await fs.mkdir(path.dirname(resolved.path), { recursive: true })
  try {
    await fs.writeFile(resolved.path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if (isErrno(err, 'EEXIST')) throw new PluginError('EXISTS', `"${resolved.path}" already exists`)
    throw err
  }
}

export const exists = async(root: string | null, target: unknown): Promise<boolean> =>
  (await resolveInVault(root, target)).exists

/**
 * Files below `root`, skipping hidden entries, `node_modules` and symlinks.
 * `extensions` (lower-case, without the dot) filters by extension.
 */
export const listFiles = async(
  root: string | null,
  extensions?: unknown
): Promise<VaultFileEntry[]> => {
  if (!root) return []
  const wanted = Array.isArray(extensions)
    ? new Set(extensions.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase()))
    : null
  const result: VaultFileEntry[] = []
  const pending = [path.resolve(root)]
  while (pending.length > 0 && result.length < MAX_LIST_ENTRIES) {
    const dir = pending.pop()!
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') pending.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const extension = path.extname(entry.name).slice(1).toLowerCase()
      if (wanted && !wanted.has(extension)) continue
      try {
        const stat = await fs.stat(fullPath)
        result.push({ path: fullPath, name: entry.name, extension, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch {
        continue
      }
      if (result.length >= MAX_LIST_ENTRIES) break
    }
  }
  return result
}
