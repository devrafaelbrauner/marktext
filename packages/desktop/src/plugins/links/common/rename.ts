import { createLinkResolver, getLinkExtension, isMarkdownExtension, type LinkResolver } from 'common/markdownExt'
import { shortestLinkText } from './linkText'
import { mapRenamedPath, posixDirname, relativePath, stripNoteExtension } from './paths'
import { scanDocumentLinks } from './scan'

/** A rename in vault-relative POSIX paths; for folders every path inside moves along. */
export interface VaultRename {
  oldPath: string
  newPath: string
}

interface TextEdit {
  start: number
  end: number
  replacement: string
}

const encodeMarkdownPath = (path: string): string =>
  path
    .split('/')
    .map((segment) =>
      segment.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E')
    )
    .join('/')

const keepsMarkdownExtension = (target: string): boolean => {
  const extension = getLinkExtension(target)
  return extension !== '' && isMarkdownExtension(extension)
}

/** New wikilink target for `path`, in the style of the written `target` (bare name, vault path, explicit extension). */
const wikilinkTargetFor = (target: string, path: string, sourcePath: string, resolver: LinkResolver): string => {
  const withExtension = keepsMarkdownExtension(target)
  if (/^\.\.?\//.test(target)) {
    const relative = relativePath(posixDirname(sourcePath), path)
    const text = withExtension ? relative : stripNoteExtension(relative)
    return text.startsWith('.') ? text : `./${text}`
  }
  if (target.includes('/')) return withExtension ? path : stripNoteExtension(path)
  const shortest = shortestLinkText(path, sourcePath, resolver)
  if (!withExtension) return shortest
  return shortest.includes('/') ? path : path.slice(path.lastIndexOf('/') + 1)
}

const markdownDestinationFor = (rawDestination: string, target: string, path: string, sourcePath: string): string => {
  const bracketed = rawDestination.startsWith('<') && rawDestination.endsWith('>')
  const inner = bracketed ? rawDestination.slice(1, -1) : rawDestination
  const hash = inner.indexOf('#')
  const fragment = hash === -1 ? '' : inner.slice(hash)
  const extensionless = getLinkExtension(target) === ''
  let next = inner.trimStart().startsWith('/') ? `/${path}` : relativePath(posixDirname(sourcePath), path)
  if (extensionless) next = stripNoteExtension(next)
  return bracketed ? `<${next}${fragment}>` : encodeMarkdownPath(next) + fragment
}

const applyEdits = (text: string, edits: TextEdit[]): string => {
  let out = text
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
  }
  return out
}

export interface RewriteContext {
  /** Vault path of the note before and after the rename (equal unless the note itself moved). */
  oldSourcePath: string
  newSourcePath: string
  /** Resolver over the vault as it was before the rename. */
  oldResolver: LinkResolver
  /** Resolver over the vault after the rename. */
  newResolver: LinkResolver
  rename: VaultRename
}

/**
 * Rewrites the links of one note that pointed at a renamed file (or into a
 * renamed folder) so they keep pointing at it, and the relative links of a
 * note that moved itself. A link is only touched when it resolved before
 * and no longer resolves to the moved file; alias, heading, block id,
 * subpath and the written style are kept. Returns null when nothing changes.
 */
export const rewriteLinks = (markdown: string, context: RewriteContext): { content: string; count: number } | null => {
  const { oldSourcePath, newSourcePath, oldResolver, newResolver, rename } = context
  const { doc, wikilinks, markdownLinks } = scanDocumentLinks(markdown)
  const edits: TextEdit[] = []
  const expectedTarget = (resolvedBefore: string | null): string | null =>
    resolvedBefore === null ? null : mapRenamedPath(resolvedBefore, rename.oldPath, rename.newPath) ?? resolvedBefore

  for (const occurrence of wikilinks) {
    const { link } = occurrence
    if (!link.target) continue
    const expected = expectedTarget(oldResolver.resolve(link.target, oldSourcePath))
    if (expected === null || newResolver.resolve(link.target, newSourcePath) === expected) continue
    const inner = doc.text.slice(occurrence.innerStart, occurrence.innerEnd)
    let targetEnd = inner.length
    for (const separator of ['#', '|']) {
      const index = inner.indexOf(separator)
      if (index !== -1 && index < targetEnd) targetEnd = index
    }
    if (targetEnd > 0 && targetEnd < inner.length && inner[targetEnd] === '|' && inner[targetEnd - 1] === '\\') targetEnd--
    const segment = inner.slice(0, targetEnd)
    const leading = segment.length - segment.trimStart().length
    const written = segment.trim()
    const start = occurrence.innerStart + leading
    edits.push({
      start,
      end: start + written.length,
      replacement: wikilinkTargetFor(written, expected, newSourcePath, newResolver)
    })
  }

  for (const link of markdownLinks) {
    const { target } = link.destination
    // Markdown links are file paths for every other markdown reader, so they
    // must keep resolving as a path, not through Obsidian's name lookup.
    const asPath = /^(\.\.?\/|\/)/.test(target) ? target : `./${target}`
    const expected = expectedTarget(oldResolver.resolve(asPath, oldSourcePath))
    if (expected === null || newResolver.resolve(asPath, newSourcePath) === expected) continue
    const raw = doc.text.slice(link.destStart, link.destEnd)
    edits.push({
      start: link.destStart,
      end: link.destEnd,
      replacement: markdownDestinationFor(raw, target, expected, newSourcePath)
    })
  }

  if (!edits.length) return null
  const rewritten = applyEdits(doc.text, edits)
  const content = /\r\n/.test(markdown) ? rewritten.replace(/\n/g, '\r\n') : rewritten
  return { content, count: edits.length }
}

export interface NoteSource {
  /** Vault path after the rename. */
  path: string
  content: string
}

export interface PlannedRewrite {
  path: string
  content: string
  count: number
}

/**
 * Link updates for a rename across the vault. `paths` lists every vault file
 * after the rename; the pre-rename vault is derived from it, so the result
 * does not depend on whether the index already saw the rename.
 */
export const planRenameRewrites = (rename: VaultRename, paths: string[], notes: NoteSource[]): PlannedRewrite[] => {
  const oldPaths = paths.map((path) => mapRenamedPath(path, rename.newPath, rename.oldPath) ?? path)
  const oldResolver = createLinkResolver(oldPaths)
  const newResolver = createLinkResolver(paths)
  const rewrites: PlannedRewrite[] = []
  for (const note of notes) {
    const oldSourcePath = mapRenamedPath(note.path, rename.newPath, rename.oldPath) ?? note.path
    const result = rewriteLinks(note.content, {
      oldSourcePath,
      newSourcePath: note.path,
      oldResolver,
      newResolver,
      rename
    })
    if (result) rewrites.push({ path: note.path, ...result })
  }
  return rewrites
}
