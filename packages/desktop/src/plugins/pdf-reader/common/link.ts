/**
 * Link text for "Copy link to this page", following Obsidian's "shortest path
 * when possible" style: the file name when no other file in the vault has the
 * same name (case-insensitively), otherwise the full vault-relative path.
 */

const toPosix = (path: string): string => path.replace(/\\/g, '/')

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/**
 * Path of `absolutePath` relative to the vault root `rootPath`, with `/`
 * separators, or null when it lies outside the vault. Windows drive paths
 * compare case-insensitively.
 */
export const toVaultPath = (rootPath: string, absolutePath: string): string | null => {
  const root = toPosix(rootPath).replace(/\/+$/, '')
  const file = toPosix(absolutePath)
  const caseInsensitive = /^[a-z]:\//i.test(root)
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root
  const comparableFile = caseInsensitive ? file.toLowerCase() : file
  if (!comparableFile.startsWith(`${comparableRoot}/`)) return null
  return file.slice(root.length + 1) || null
}

/** Shortest link target that names `vaultPath` unambiguously among `vaultPaths` (all vault-relative). */
export const shortestLinkTarget = (vaultPath: string, vaultPaths: Iterable<string>): string => {
  const name = nameOf(vaultPath)
  const lowerName = name.toLowerCase()
  for (const other of vaultPaths) {
    if (other !== vaultPath && nameOf(other).toLowerCase() === lowerName) return vaultPath
  }
  return name
}

// Characters that end or split a wikilink target: `]]`, `|` (alias), `#` (subpath), `^` (block), `[[`.
const WIKILINK_UNSAFE = /[[\]|#^]/

/**
 * `[[target#page=N]]`, or a markdown link when `target` contains characters a
 * wikilink cannot carry (Obsidian forbids them in file names, but other tools
 * do not).
 */
export const formatPageLink = (target: string, page: number): string => {
  if (!WIKILINK_UNSAFE.test(target)) return `[[${target}#page=${page}]]`
  const label = nameOf(target).replace(/[[\]\\]/g, (char) => `\\${char}`)
  const destination = target
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `[${label}](${destination}#page=${page})`
}

/**
 * Link to `page` of the PDF at `absolutePath`. `vaultFiles` are the absolute
 * paths of the vault's files that could share its name, or null when they are
 * unknown (the full vault path is then the only safe target). Without a vault,
 * or for a file outside it, the link is the bare file name.
 */
export const buildPageLink = (options: {
  absolutePath: string
  rootPath: string | null
  vaultFiles: Iterable<string> | null
  page: number
}): string => {
  const { absolutePath, rootPath, vaultFiles, page } = options
  const vaultPath = rootPath ? toVaultPath(rootPath, absolutePath) : null
  if (!rootPath || !vaultPath) return formatPageLink(nameOf(toPosix(absolutePath)), page)
  if (!vaultFiles) return formatPageLink(vaultPath, page)
  const vaultPaths: string[] = []
  for (const file of vaultFiles) {
    const relative = toVaultPath(rootPath, file)
    if (relative) vaultPaths.push(relative)
  }
  return formatPageLink(shortestLinkTarget(vaultPath, vaultPaths), page)
}
