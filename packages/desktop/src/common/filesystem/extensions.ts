export const MARKDOWN_EXTENSIONS: readonly string[] = Object.freeze([
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

export const MARKDOWN_INCLUSIONS: readonly string[] = Object.freeze(
  MARKDOWN_EXTENSIONS.map((x) => '*.' + x)
)

export const IMAGE_EXTENSIONS: readonly string[] = Object.freeze([
  'jpeg',
  'jpg',
  'png',
  'gif',
  'svg',
  'webp'
])

// Non-markdown files that open in an in-app tab when a plugin registers a view
// for their extension (otherwise the OS default application opens them).
export const VIEWABLE_ASSET_EXTENSIONS: readonly string[] = Object.freeze(['pdf'])
