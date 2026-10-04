import { getLinkExtension, isMarkdownExtension } from './extensions'

/**
 * Link resolution over vault-relative POSIX paths (`Folder/Note.md`).
 * Obsidian semantics: an exact vault path wins, then a path relative to the
 * linking note, then a case-insensitive match on the file name (or on the
 * trailing path segments when the target contains `/`), preferring the
 * shortest path. Targets without extension name `.md` notes; targets with an
 * extension (`doc.pdf`, `Note.md`) must match the file name exactly.
 */
export interface LinkResolver {
  /**
   * Vault-relative path `target` resolves to, or null. `sourcePath` is the
   * vault-relative path of the linking note; an empty target (`[[#Heading]]`)
   * resolves to it. With `preferRelative` (markdown links) paths relative to
   * the source folder win over vault-root paths.
   */
  resolve(target: string, sourcePath: string, options?: { preferRelative?: boolean }): string | null
}

const byLengthThenName = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)

/** Collapses `.`/`..` segments; null when the path climbs above the vault root. */
const normalizeRelative = (path: string): string | null => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

const dirnameOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export const createLinkResolver = (paths: Iterable<string>): LinkResolver => {
  const exact = new Set<string>()
  const byLowerPath = new Map<string, string[]>()
  const byLowerName = new Map<string, string[]>()
  for (const path of paths) {
    exact.add(path)
    const lower = path.toLowerCase()
    const samePath = byLowerPath.get(lower)
    if (samePath) samePath.push(path)
    else byLowerPath.set(lower, [path])
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    const sameName = byLowerName.get(name)
    if (sameName) sameName.push(path)
    else byLowerName.set(name, [path])
  }
  for (const list of byLowerPath.values()) list.sort(byLengthThenName)
  for (const list of byLowerName.values()) list.sort(byLengthThenName)

  const lookup = (candidate: string | null): string | null => {
    if (candidate === null || candidate === '') return null
    if (exact.has(candidate)) return candidate
    return byLowerPath.get(candidate.toLowerCase())?.[0] ?? null
  }

  return {
    resolve(target, sourcePath, options = {}) {
      let cleaned = target.trim().replace(/\\/g, '/')
      if (!cleaned) return exact.has(sourcePath) ? sourcePath : null
      const explicitRelative = /^\.\.?\//.test(cleaned)
      cleaned = cleaned.replace(/^\/+/, '')

      const extension = getLinkExtension(cleaned)
      const candidates = extension === ''
        ? [`${cleaned}.md`, cleaned]
        : isMarkdownExtension(extension) ? [cleaned] : [cleaned, `${cleaned}.md`]
      const sourceDir = dirnameOf(sourcePath)
      const relative = (): string | null => {
        for (const candidate of candidates) {
          const hit = lookup(normalizeRelative(sourceDir ? `${sourceDir}/${candidate}` : candidate))
          if (hit) return hit
        }
        return null
      }
      const vaultPath = (): string | null => {
        for (const candidate of candidates) {
          const hit = lookup(normalizeRelative(candidate))
          if (hit) return hit
        }
        return null
      }

      if (explicitRelative) return relative()
      const direct = options.preferRelative ? relative() ?? vaultPath() : vaultPath() ?? relative()
      if (direct) return direct

      for (const candidate of candidates) {
        const lower = candidate.toLowerCase()
        const name = lower.slice(lower.lastIndexOf('/') + 1)
        const matches = byLowerName.get(name)
        if (!matches) continue
        const hit = lower.includes('/') ? matches.find((path) => path.toLowerCase().endsWith(`/${lower}`)) : matches[0]
        if (hit) return hit
      }
      return null
    }
  }
}

/** One-off resolution; build a resolver with createLinkResolver to resolve many links over the same file set. */
export const resolveLinkTarget = (target: string, sourcePath: string, allPaths: Iterable<string>): string | null =>
  createLinkResolver(allPaths).resolve(target, sourcePath)
