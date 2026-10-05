import type { VaultIndexCache, VaultIndexFs } from './types'

/**
 * Reads a persisted index; null when missing, unreadable or not shaped like a
 * cache. Malformed note entries are dropped (those notes get re-parsed).
 */
export const loadVaultIndexCache = async(fs: VaultIndexFs, file: string): Promise<VaultIndexCache | null> => {
  try {
    const data: unknown = JSON.parse(await fs.readText(file))
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

/** Writes the cache through `fs.writeText` (atomic, creates its folder). */
export const saveVaultIndexCache = async(fs: VaultIndexFs, file: string, cache: VaultIndexCache): Promise<void> => {
  await fs.writeText(file, JSON.stringify(cache))
}
