import type { Source } from './ast'
import type { PageStore } from './pages'

/**
 * Absolute paths of the notes a FROM clause selects, in index (path) order.
 * Tags match case-insensitively including nested tags; folders match the
 * vault-relative folder prefix or an exact note path (with or without
 * `.md`); `[[note]]` selects notes linking to it, `outgoing([[note]])` the
 * notes it links to.
 */
export const selectSources = (source: Source, pages: PageStore, originPath: string | null): string[] => {
  const all = pages.index.listFiles().map((file) => file.path)
  const selected = evaluateSource(source, pages, originPath, all)
  return all.filter((path) => selected.has(path))
}

const normalizeFolder = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '')

const evaluateSource = (source: Source, pages: PageStore, originPath: string | null, all: string[]): Set<string> => {
  const { index } = pages
  switch (source.kind) {
    case 'tag': {
      const wanted = source.tag.toLowerCase()
      return new Set(
        index
          .listFiles()
          .filter((file) => file.tags.some((tag) => {
            const lower = tag.toLowerCase()
            return lower === wanted || lower.startsWith(`${wanted}/`)
          }))
          .map((file) => file.path)
      )
    }
    case 'folder': {
      const folder = normalizeFolder(source.path)
      if (!folder) return new Set(all)
      return new Set(
        all.filter((path) => {
          const relative = pages.relativePath(path)
          return relative.startsWith(`${folder}/`) || relative === folder || relative === `${folder}.md`
        })
      )
    }
    case 'incoming': {
      const target = pages.link(source.target, originPath, null)
      if (target.resolved) return new Set(index.getBacklinks(target.path).map((entry) => entry.sourcePath))
      const wanted = source.target.toLowerCase()
      return new Set(
        index
          .listFiles()
          .filter((file) => file.links.some((link) => link.resolved === null && link.target.toLowerCase() === wanted))
          .map((file) => file.path)
      )
    }
    case 'outgoing': {
      const target = pages.link(source.target, originPath, null)
      const meta = target.resolved ? index.getFile(target.path) : null
      if (!meta) return new Set()
      return new Set(meta.links.flatMap((link) => (link.resolved && index.getFile(link.resolved) ? [link.resolved] : [])))
    }
    case 'and': {
      const right = evaluateSource(source.right, pages, originPath, all)
      return new Set([...evaluateSource(source.left, pages, originPath, all)].filter((path) => right.has(path)))
    }
    case 'or':
      return new Set([
        ...evaluateSource(source.left, pages, originPath, all),
        ...evaluateSource(source.right, pages, originPath, all)
      ])
    case 'not': {
      const excluded = evaluateSource(source.source, pages, originPath, all)
      return new Set(all.filter((path) => !excluded.has(path)))
    }
  }
}
