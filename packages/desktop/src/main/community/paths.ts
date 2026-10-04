/**
 * Resolves a `mt-plugin://<id>/<path>` pathname onto a file inside that
 * plugin's directory. Rejects traversal, absolute paths, null bytes and
 * symlinks that leave the directory. Virtual host paths (`/__mt/…`) are not
 * files and are handled by the protocol handler before this runs.
 */

import fs from 'fs'
import path from 'path'

export interface ResolvedPluginFile {
  /** Real path of the file, inside `root`. */
  filePath: string
}

/**
 * Relative path of `pathname` inside the plugin, or null when it is not a
 * safe relative path. `pathname` is the URL pathname (already one decode
 * from the URL parser). A second decode is applied so `%2e%2e%2f` cannot
 * hide `../`.
 */
export const safeRelativePath = (pathname: string): string | null => {
  if (!pathname || pathname.includes('\0') || pathname.includes('\\')) return null
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('\n') || decoded.includes('\r')) return null
  const trimmed = decoded.replace(/^\/+/, '')
  if (!trimmed || trimmed.startsWith('/')) return null
  const segments = trimmed.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

const insideRoot = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Absolute path of `relativePath` inside `root`, or null when the path
 * escapes, is not a regular file, or follows a symlink out of `root`.
 * `root` itself must be a real directory, not a symlink.
 */
export const resolvePluginFile = (root: string, relativePath: string): string | null => {
  if (!relativePath || relativePath.split('/').some((segment) => segment === '..' || segment === '')) return null
  let rootStat: fs.Stats
  try {
    rootStat = fs.lstatSync(root)
  } catch {
    return null
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null

  let current = root
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(current)
    } catch {
      return null
    }
    if (stat.isSymbolicLink()) {
      let target: string
      try {
        target = fs.realpathSync(current)
      } catch {
        return null
      }
      if (!insideRoot(root, target)) return null
      current = target
    }
  }
  let finalStat: fs.Stats
  try {
    finalStat = fs.statSync(current)
  } catch {
    return null
  }
  if (!finalStat.isFile()) return null
  if (!insideRoot(root, current)) return null
  return current
}
