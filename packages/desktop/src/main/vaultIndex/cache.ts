import fsPromises from 'fs/promises'
import path from 'path'
import type { VaultIndexCache } from './types'

/**
 * Reads a persisted index; null when missing, unreadable or not shaped like a
 * cache. Malformed note entries are dropped (those notes get re-parsed).
 */
export const loadVaultIndexCache = async(file: string): Promise<VaultIndexCache | null> => {
  try {
    const data: unknown = JSON.parse(await fsPromises.readFile(file, 'utf8'))
    if (!data || typeof data !== 'object') return null
    const cache = data as Partial<VaultIndexCache>
    if (typeof cache.version !== 'number' || typeof cache.rootPath !== 'string' || !Array.isArray(cache.notes)) {
      return null
    }
    const notes = cache.notes.filter((note) => {
      const meta = note?.meta
      return !!meta && typeof meta.path === 'string' && typeof meta.mtimeMs === 'number' &&
        typeof meta.size === 'number' && Array.isArray(meta.links) && Array.isArray(meta.tags) &&
        Array.isArray(note.contexts)
    })
    return { version: cache.version, rootPath: cache.rootPath, notes }
  } catch {
    return null
  }
}

/** Writes the cache atomically (temp file + rename), creating its folder. */
export const saveVaultIndexCache = async(file: string, cache: VaultIndexCache): Promise<void> => {
  await fsPromises.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await fsPromises.writeFile(temp, JSON.stringify(cache), 'utf8')
  await fsPromises.rename(temp, file)
}
