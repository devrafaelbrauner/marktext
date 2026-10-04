import { lineOfOffset } from 'common/markdownExt'
import { scanDocumentLinks } from './scan'

export interface MentionMatch {
  /** Offset into the LF-normalized text. */
  start: number
  end: number
  /** 0-based line and UTF-16 column of `start`. */
  line: number
  column: number
  /** Source text of the mention (original case). */
  text: string
  /** The whole line, for previews. */
  context: string
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

const isBoundary = (char: string | undefined): boolean => char === undefined || !WORD_CHAR.test(char)

/**
 * Plain-text occurrences of any of `terms` (case-insensitive, whole words)
 * outside links, code, math, HTML, comments and front matter. Overlapping
 * terms yield the longest match; at most `limit` results.
 */
export const findMentions = (markdown: string, terms: string[], limit = Infinity): MentionMatch[] => {
  const needles = [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  )
  if (!needles.length) return []
  const { doc, prose } = scanDocumentLinks(markdown)
  const haystack = prose.toLowerCase()
  // Case folding that changes the length would shift offsets; fall back to an exact-case search.
  const folded = haystack.length === prose.length
  const search = folded ? haystack : prose
  const lines = doc.text.split('\n')
  const found: MentionMatch[] = []
  const taken: Array<[number, number]> = []

  for (const term of needles) {
    let index = search.indexOf(term)
    while (index !== -1) {
      const end = index + term.length
      if (
        isBoundary(prose[index - 1]) &&
        isBoundary(prose[end]) &&
        !taken.some(([from, to]) => index < to && end > from)
      ) {
        taken.push([index, end])
        const line = lineOfOffset(doc.lineStarts, index)
        found.push({
          start: index,
          end,
          line,
          column: index - doc.lineStarts[line],
          text: doc.text.slice(index, end),
          context: lines[line]
        })
      }
      index = search.indexOf(term, index + 1)
    }
  }
  found.sort((a, b) => a.start - b.start)
  return found.slice(0, limit)
}
