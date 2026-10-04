import { parseWikilinkContent } from 'common/markdownExt'

export interface DiagramLinkTarget {
  pathname: string
  /** Part after `#` for non-note targets, e.g. `page=3`. */
  subpath?: string
}

/**
 * Resolves the label of a mermaid `internal-link` node the way Obsidian does:
 * as the inside of a wikilink (`Note`, `Folder/Note`, `doc.pdf#page=3`).
 * Returns null for an empty label or a target that does not resolve.
 * @param resolve the vault link resolver (`ctx.metadata.resolveLink`)
 */
export const resolveDiagramLink = async(
  label: string,
  sourcePath: string,
  resolve: (target: string, sourcePath: string) => Promise<string | null>
): Promise<DiagramLinkTarget | null> => {
  const link = parseWikilinkContent(label.trim(), false)
  if (!link?.target) return null
  const pathname = await resolve(link.target, sourcePath)
  if (!pathname) return null
  return link.subpath ? { pathname, subpath: link.subpath } : { pathname }
}
