/**
 * Mirror of MARKDOWN_EXTENSIONS in common/filesystem/paths.ts, which imports
 * Node `fs` and therefore cannot be used by these DOM- and Node-free parsers.
 * A unit spec pins both lists together.
 */
export const MARKDOWN_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  'markdown',
  'mdown',
  'mkdn',
  'md',
  'mkd',
  'mdwn',
  'mdtxt',
  'mdtext',
  'mdx',
  'text',
  'txt'
])

const MARKDOWN_EXTENSION_LOOKUP: Record<string, true> = Object.fromEntries(
  MARKDOWN_FILE_EXTENSIONS.map((extension) => [extension, true])
)

/**
 * Lower-cased extension (without the dot) of the last `/`-separated segment
 * of a link target or file name, or '' when there is none. An extension must
 * contain a letter, so `Version 1.2` and `2026.10` have no extension.
 */
export const getLinkExtension = (name: string): string => {
  const segment = name.slice(name.lastIndexOf('/') + 1)
  const match = /\.([0-9a-z]*[a-z][0-9a-z]*)$/i.exec(segment)
  return match ? match[1].toLowerCase() : ''
}

export const isMarkdownExtension = (extension: string): boolean =>
  MARKDOWN_EXTENSION_LOOKUP[extension.toLowerCase()] === true

/** True when a link target names a note: it has no extension or a markdown one. */
export const isNoteTarget = (target: string): boolean => {
  const extension = getLinkExtension(target)
  return extension === '' || MARKDOWN_EXTENSION_LOOKUP[extension] === true
}
