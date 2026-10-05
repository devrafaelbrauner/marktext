import { minimatch } from 'minimatch'

/**
 * Returns true if the pathname matches one of the exclude patterns.
 */
export const checkPathExcludePattern = (pathname: string, patterns: readonly string[]): boolean => {
  if (!pathname || typeof pathname !== 'string') return false
  for (const pattern of patterns) {
    if (minimatch(pathname, pattern, { matchBase: true })) {
      return true
    }
  }
  return false
}
