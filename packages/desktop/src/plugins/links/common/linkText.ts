import type { LinkResolver } from 'common/markdownExt'
import { noteName, posixDirname, relativePath, stripNoteExtension } from './paths'

export type NewLinkFormat = 'shortest' | 'relative' | 'absolute'

/**
 * Wikilink target addressing the vault path `path` from the note `sourcePath`
 * (both vault-relative): the bare name when it resolves to that file, else
 * the vault path. Markdown extensions are dropped, other extensions kept.
 */
export const shortestLinkText = (path: string, sourcePath: string, resolver: LinkResolver): string => {
  const name = noteName(path)
  return resolver.resolve(name, sourcePath) === path ? name : stripNoteExtension(path)
}

export const linkTextFor = (
  path: string,
  sourcePath: string,
  resolver: LinkResolver,
  format: NewLinkFormat
): string => {
  if (format === 'absolute') return stripNoteExtension(path)
  if (format === 'relative') {
    const relative = stripNoteExtension(relativePath(posixDirname(sourcePath), path))
    return resolver.resolve(relative, sourcePath) === path ? relative : `./${relative}`
  }
  return shortestLinkText(path, sourcePath, resolver)
}
