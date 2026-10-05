// Which virtual paths the renderer may reach through `mt::fs::*` (desktop
// main/security/fsAccess.ts + pathScope.ts). Same intent: the open folder,
// the folders of opened documents, documents the user picked, the image
// folders and the app's own user-data subfolders. The user-data root itself
// is out of scope (preferences, keybindings, buffers, plugin state).
//
// Paths are virtual (no symlinks on SAF), so containment is lexical after
// normalization; the native side refuses anything without a grant anyway.

import { posix } from 'pathe'
import { isUncOrRemoteHostPath } from 'common/mtFileUrl'

// desktop APP_USER_DATA_SUBDIRS
const USER_DATA_SUBDIRS = ['logs', 'screenshot', 'images', 'editorStates', 'vault-index', 'themes']

/** Absolute, normalized virtual path, or `null` for anything that cannot be one. */
export function normalizeVirtualPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate.startsWith('/')) return null
  if (candidate.includes('\0') || candidate.includes('\\') || isUncOrRemoteHostPath(candidate)) return null
  const normalized = posix.normalize(candidate)
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

export const isInside = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(root === '/' ? '/' : `${root}/`)

/**
 * imageFolderPath may contain a ${filename} token expanded per tab in the
 * renderer; the stable prefix is the directory the expanded path stays under.
 */
function imageFolderRoot(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  const index = raw.indexOf('${' + 'filename}')
  return normalizeVirtualPath(index === -1 ? raw : raw.slice(0, index).replace(/\/+$/, ''))
}

export interface ScopeSources {
  userDataPath: string
  rootPath: () => string | null
  userData: () => Record<string, unknown>
}

export class PathScope {
  private readonly openedFiles = new Set<string>()
  private readonly grantedFiles = new Set<string>()

  constructor(private readonly sources: ScopeSources) {}

  /** A document open in a tab: its folder becomes reachable (relative images). */
  addOpenedFile(path: string): void {
    this.openedFiles.add(path)
  }

  removeOpenedFile(path: string): void {
    this.openedFiles.delete(path)
  }

  /** A path the user chose in a picker. */
  grantFile(path: string): void {
    this.grantedFiles.add(path)
  }

  directories(): string[] {
    const { userDataPath, rootPath, userData } = this.sources
    const dirs = USER_DATA_SUBDIRS.map((name) => `${userDataPath}/${name}`)
    const root = rootPath()
    if (root) dirs.push(root)
    for (const file of this.openedFiles) dirs.push(posix.dirname(file))
    const data = userData()
    for (const raw of [data.imageFolderPath, data.screenshotFolderPath]) {
      const folder = imageFolderRoot(raw)
      if (folder) dirs.push(folder)
    }
    return dirs
  }

  isAllowed(candidate: unknown): boolean {
    const path = normalizeVirtualPath(candidate)
    if (!path) return false
    if (this.grantedFiles.has(path)) return true
    // The user-data root (and anything above it) is never a root itself.
    return this.directories().some((dir) => dir !== this.sources.userDataPath && dir !== '/' && isInside(dir, path))
  }
}
