import { isNoteTarget } from './extensions'

export interface ParsedWikilink {
  /** Target as written, without heading/block/subpath/alias; '' for same-note links like `[[#Heading]]`. */
  target: string
  alias?: string
  heading?: string
  blockId?: string
  /** Raw part after `#` when the target is not a note (`page=3` in `[[doc.pdf#page=3]]`). */
  subpath?: string
  embed: boolean
}

/** Source of a regex matching one wikilink or embed on a single line; group 1 is the text between the brackets. */
export const WIKILINK_SOURCE = '!?\\[\\[([^[\\]\\n]+?)\\]\\]'
const WIKILINK_AT_START = new RegExp(`^${WIKILINK_SOURCE}`)

const BLOCK_ID_SUFFIX = /\^([A-Za-z0-9-]+)$/

const unescape = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, '$1')

/**
 * Parses the text between `[[` and `]]`. The alias separator is the first
 * `|`; inside tables it is written `\|`, which is accepted too. The part
 * after the first `#` is a heading (optionally ending in `^blockId`) or just
 * `^blockId` for notes, and an opaque subpath for other files. Returns null
 * for links without target, heading or block id (`[[]]`, `[[|x]]`).
 */
export const parseWikilinkContent = (inner: string, embed: boolean): ParsedWikilink | null => {
  let body = inner
  let alias: string | undefined
  const pipe = inner.indexOf('|')
  if (pipe !== -1) {
    const escaped = pipe > 0 && inner[pipe - 1] === '\\'
    body = inner.slice(0, escaped ? pipe - 1 : pipe)
    alias = unescape(inner.slice(pipe + 1).trim()) || undefined
  }

  const hash = body.indexOf('#')
  const target = unescape((hash === -1 ? body : body.slice(0, hash)).trim())
  const link: ParsedWikilink = { target, embed }
  if (alias !== undefined) link.alias = alias

  if (hash !== -1) {
    const rest = body.slice(hash + 1).trim()
    if (!isNoteTarget(target)) {
      if (rest) link.subpath = rest
    } else {
      const block = BLOCK_ID_SUFFIX.exec(rest)
      const heading = unescape((block ? rest.slice(0, block.index) : rest).trim())
      if (heading) link.heading = heading
      if (block) link.blockId = block[1]
    }
  }

  if (!link.target && link.heading === undefined && link.blockId === undefined) return null
  return link
}

/** Parses a complete `[[…]]` or `![[…]]`; null when `raw` is anything else. */
export const parseWikilink = (raw: string): ParsedWikilink | null => {
  const match = WIKILINK_AT_START.exec(raw)
  if (!match || match[0].length !== raw.length) return null
  return parseWikilinkContent(match[1], raw.startsWith('!'))
}

/** Matches a wikilink or embed at the start of `src`, for inline lexers. */
export const matchWikilink = (src: string): { raw: string; link: ParsedWikilink } | null => {
  const match = WIKILINK_AT_START.exec(src)
  if (!match) return null
  const link = parseWikilinkContent(match[1], match[0].startsWith('!'))
  return link ? { raw: match[0], link } : null
}
