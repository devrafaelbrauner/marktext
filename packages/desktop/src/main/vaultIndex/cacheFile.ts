import path from 'path'
import { createHash } from 'crypto'

/** `<cacheDir>/<sha1(root)>.json`. */
export const getVaultIndexCacheFile = (cacheDir: string, rootPath: string): string =>
  path.join(cacheDir, `${createHash('sha1').update(path.resolve(rootPath)).digest('hex')}.json`)
