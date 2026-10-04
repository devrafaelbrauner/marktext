/**
 * Find-in-document model. Each page's text is the concatenation of its pdf.js
 * text items (a line break after items flagged `hasEOL`). Matching ignores
 * case, diacritics and compatibility forms (`ação` ≈ `acao`, `ﬁ` ≈ `fi`), and
 * any run of whitespace matches any other run, so a phrase still matches when
 * the PDF splits it over two lines.
 */

/** The subset of a pdf.js `TextItem` the model reads. */
export interface TextItemLike {
  str: string
  hasEOL?: boolean
}

export interface PageText {
  text: string
  /** Offset of each item's `str` in `text`; separators between items belong to no item. */
  itemStarts: number[]
  itemLengths: number[]
}

/** `[start, end)` in UTF-16 units of a page's `text`. */
export interface TextRange {
  start: number
  end: number
}

/** Part of one text item covered by a match; offsets are relative to the item's `str`. */
export interface ItemRange {
  item: number
  start: number
  end: number
}

/** Text folded for matching, with the `text` range each folded character came from. */
export interface FoldedText {
  folded: string
  sourceStart: number[]
  sourceEnd: number[]
}

/** Position of one match: page index (0-based) and index within that page's matches. */
export interface MatchCursor {
  page: number
  index: number
}

/**
 * Matches per page index; `undefined` marks a page that has not been searched
 * yet (pages are scanned progressively).
 */
export type MatchesByPage = ReadonlyArray<readonly TextRange[] | undefined>

export const buildPageText = (items: readonly TextItemLike[]): PageText => {
  let text = ''
  const itemStarts: number[] = []
  const itemLengths: number[] = []
  for (const item of items) {
    itemStarts.push(text.length)
    itemLengths.push(item.str.length)
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return { text, itemStarts, itemLengths }
}

const COMBINING_MARKS = /\p{M}/gu
const WHITESPACE = /\s/

const foldCodePoint = (char: string): string => {
  const code = char.charCodeAt(0)
  if (code < 0x80) return code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 32) : char
  return char.toLowerCase().normalize('NFKD').replace(COMBINING_MARKS, '')
}

export const foldText = (text: string): FoldedText => {
  let folded = ''
  const sourceStart: number[] = []
  const sourceEnd: number[] = []
  let offset = 0
  for (const char of text) {
    const start = offset
    offset += char.length
    if (WHITESPACE.test(char)) {
      if (folded.endsWith(' ')) {
        sourceEnd[sourceEnd.length - 1] = offset
      } else {
        folded += ' '
        sourceStart.push(start)
        sourceEnd.push(offset)
      }
      continue
    }
    // A character can fold to several (ligatures) or none (a combining mark,
    // which then belongs to the character before it).
    const units = foldCodePoint(char)
    if (!units && sourceEnd.length) sourceEnd[sourceEnd.length - 1] = offset
    for (const unit of units) {
      for (let i = 0; i < unit.length; i++) {
        sourceStart.push(start)
        sourceEnd.push(offset)
      }
      folded += unit
    }
  }
  return { folded, sourceStart, sourceEnd }
}

/** Non-overlapping matches of `query` in the folded page text, in document order. */
export const findMatches = (page: FoldedText, query: string): TextRange[] => {
  const needle = foldText(query).folded
  if (!needle.trim()) return []
  const ranges: TextRange[] = []
  let from = 0
  for (;;) {
    const at = page.folded.indexOf(needle, from)
    if (at === -1) break
    const last = at + needle.length - 1
    ranges.push({ start: page.sourceStart[at], end: page.sourceEnd[last] })
    from = at + needle.length
  }
  return ranges
}

/** Splits a match into the parts of the text items it covers (for highlighting the text layer). */
export const toItemRanges = (page: PageText, range: TextRange): ItemRange[] => {
  const parts: ItemRange[] = []
  for (let item = 0; item < page.itemStarts.length; item++) {
    const itemStart = page.itemStarts[item]
    const itemEnd = itemStart + page.itemLengths[item]
    if (itemEnd <= range.start) continue
    if (itemStart >= range.end) break
    const start = Math.max(range.start, itemStart) - itemStart
    const end = Math.min(range.end, itemEnd) - itemStart
    if (end > start) parts.push({ item, start, end })
  }
  return parts
}

export const countMatches = (matches: MatchesByPage): number => {
  let total = 0
  for (const page of matches) total += page?.length ?? 0
  return total
}

/** First match on page `fromPage` or after it, wrapping around to the start; null when there is none. */
export const firstMatchFrom = (matches: MatchesByPage, fromPage: number): MatchCursor | null => {
  const count = matches.length
  for (let step = 0; step < count; step++) {
    const page = (((fromPage + step) % count) + count) % count
    if (matches[page]?.length) return { page, index: 0 }
  }
  return null
}

/** The match after (`direction` 1) or before (-1) `cursor`, wrapping around the document. */
export const stepMatch = (matches: MatchesByPage, cursor: MatchCursor, direction: 1 | -1): MatchCursor | null => {
  const count = matches.length
  if (!count) return null
  const current = matches[cursor.page]
  const nextIndex = cursor.index + direction
  if (current && nextIndex >= 0 && nextIndex < current.length) return { page: cursor.page, index: nextIndex }
  for (let step = 1; step <= count; step++) {
    const page = (((cursor.page + direction * step) % count) + count) % count
    const list = matches[page]
    if (list?.length) return { page, index: direction > 0 ? 0 : list.length - 1 }
  }
  return null
}

/** 1-based position of `cursor` among all matches found so far. */
export const matchOrdinal = (matches: MatchesByPage, cursor: MatchCursor): number => {
  let ordinal = cursor.index + 1
  for (let page = 0; page < cursor.page; page++) ordinal += matches[page]?.length ?? 0
  return ordinal
}
