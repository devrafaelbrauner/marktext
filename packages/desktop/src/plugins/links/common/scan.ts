import {
  findMarkdownLinks,
  maskDocument,
  parseWikilinkContent,
  WIKILINK_SOURCE,
  type MarkdownLinkMatch,
  type MaskedDocument,
  type ParsedWikilink
} from 'common/markdownExt'

export interface WikilinkOccurrence {
  /** Offset of `[[` (or of `!` for embeds). */
  start: number
  end: number
  innerStart: number
  innerEnd: number
  link: ParsedWikilink
}

export interface DocumentLinks {
  doc: MaskedDocument
  wikilinks: WikilinkOccurrence[]
  markdownLinks: MarkdownLinkMatch[]
  /** `doc.inline` with every wikilink and markdown link blanked as well (plain prose only). */
  prose: string
}

const blankRange = (chars: string[], from: number, to: number): void => {
  for (let i = from; i < to; i++) {
    if (chars[i] !== '\n') chars[i] = ' '
  }
}

/**
 * Wikilinks and markdown links of a document, with the vault index's rules
 * (parseNote): nothing inside code, math, HTML, comments or front matter.
 * Offsets address `doc.text`, the LF-normalized source.
 */
export const scanDocumentLinks = (markdown: string): DocumentLinks => {
  const doc = maskDocument(markdown)
  const masked = doc.inline.split('')
  const wikilinks: WikilinkOccurrence[] = []
  const regex = new RegExp(WIKILINK_SOURCE, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(doc.inline)) !== null) {
    const embed = match[0].startsWith('!')
    const innerStart = match.index + (embed ? 3 : 2)
    const innerEnd = innerStart + match[1].length
    blankRange(masked, match.index, match.index + match[0].length)
    const link = parseWikilinkContent(doc.text.slice(innerStart, innerEnd), embed)
    if (link) wikilinks.push({ start: match.index, end: match.index + match[0].length, innerStart, innerEnd, link })
  }
  const markdownLinks = findMarkdownLinks(masked.join(''), doc.text)
  for (const link of markdownLinks) blankRange(masked, link.start, link.end)
  return { doc, wikilinks, markdownLinks, prose: masked.join('') }
}
