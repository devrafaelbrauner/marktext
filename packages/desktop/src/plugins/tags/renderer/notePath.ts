import { getLinkExtension, isMarkdownExtension } from 'common/markdownExt'

/** Note name (markdown extension dropped) and its folder relative to `root`, `/`-separated, for lists. */
export const describeNotePath = (path: string, root: string | null): { name: string; folder: string } => {
  const inRoot = !!root && (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))
  const parts = (inRoot && root ? path.slice(root.length + 1) : path).split(/[\\/]/)
  const file = parts.pop() ?? path
  const extension = getLinkExtension(file)
  const name = extension && isMarkdownExtension(extension) ? file.slice(0, -(extension.length + 1)) : file
  return { name, folder: parts.join('/') }
}
