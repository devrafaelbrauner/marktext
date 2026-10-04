import { isMarkdownExtension, getLinkExtension } from 'common/markdownExt'

/**
 * Conversions between absolute OS paths and the vault-relative POSIX paths
 * (`Folder/Note.md`) the link resolver works with.
 */

const separatorOf = (root: string): string => (root.includes('\\') && !root.includes('/') ? '\\' : '/')

const trimTrailingSeparator = (path: string): string => path.replace(/[\\/]+$/, '')

/** Vault-relative POSIX path of `absolute`, or null when it is not inside `root`. */
export const toVaultPath = (root: string, absolute: string): string | null => {
  const base = trimTrailingSeparator(root)
  if (!absolute.startsWith(base)) return null
  const rest = absolute.slice(base.length)
  if (rest[0] !== '/' && rest[0] !== '\\') return null
  return rest.slice(1).replace(/\\/g, '/')
}

export const toAbsolutePath = (root: string, vaultPath: string): string => {
  const sep = separatorOf(root)
  const parts = vaultPath.split('/').filter(Boolean)
  return [trimTrailingSeparator(root), ...parts].join(sep)
}

export const posixDirname = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export const posixBasename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** File name without a markdown extension; other extensions are kept (`doc.pdf`). */
export const noteName = (path: string): string => stripNoteExtension(posixBasename(path))

/** Removes a markdown extension (`Folder/Note.md` → `Folder/Note`); other files keep theirs. */
export const stripNoteExtension = (path: string): string => {
  const extension = getLinkExtension(path)
  return extension && isMarkdownExtension(extension) ? path.slice(0, -(extension.length + 1)) : path
}

export const isMarkdownPath = (path: string): boolean => {
  const extension = getLinkExtension(path)
  return extension !== '' && isMarkdownExtension(extension)
}

/** POSIX path from folder `fromDir` to `to` (both vault-relative), e.g. `../Archive/Notes.md`. */
export const relativePath = (fromDir: string, to: string): string => {
  const from = fromDir ? fromDir.split('/') : []
  const target = to.split('/')
  let common = 0
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++
  const ups = from.slice(common).map(() => '..')
  return [...ups, ...target.slice(common)].join('/')
}

/**
 * Maps `path` through a rename of `oldPath` to `newPath` (a file, or a folder
 * and everything inside it); null when the rename does not affect `path`.
 */
export const mapRenamedPath = (path: string, oldPath: string, newPath: string): string | null => {
  if (path === oldPath) return newPath
  if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length)
  return null
}
