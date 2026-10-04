import { isNoteTarget } from './extensions'

export interface LinkDestination {
  /** URL-decoded path as written, without the `#fragment`. */
  target: string
  heading?: string
  blockId?: string
  /** Decoded fragment when the target is not a note (`page=3` in `doc.pdf#page=3`). */
  subpath?: string
}

export interface MarkdownLinkMatch {
  /** UTF-16 offset of `[` (or of `!` for images). */
  start: number
  /** Offset just past the closing `)`. */
  end: number
  embed: boolean
  destination: LinkDestination
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const BLOCK_ID_SUFFIX = /\^([A-Za-z0-9-]+)$/

const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * Interprets a link destination as a vault path. Returns null for URLs with
 * a scheme (`https:`, `mailto:`, `C:` …), protocol-relative URLs and
 * same-document anchors (`#heading`), none of which address a vault file.
 */
export const parseLinkDestination = (raw: string): LinkDestination | null => {
  let dest = raw.trim()
  if (dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1).trim()
  if (!dest || dest.startsWith('#') || dest.startsWith('//') || SCHEME.test(dest)) return null

  const hash = dest.indexOf('#')
  const target = safeDecode(hash === -1 ? dest : dest.slice(0, hash))
  if (!target) return null
  const result: LinkDestination = { target }
  if (hash !== -1) {
    const fragment = safeDecode(dest.slice(hash + 1))
    if (!isNoteTarget(target)) {
      if (fragment) result.subpath = fragment
    } else {
      const block = BLOCK_ID_SUFFIX.exec(fragment)
      const heading = (block ? fragment.slice(0, block.index) : fragment).trim()
      if (heading) result.heading = heading
      if (block) result.blockId = block[1]
    }
  }
  return result
}

/** Offset of the `]` closing the label opened at `open`, or -1 (labels never span a blank line). */
const findLabelEnd = (text: string, open: number): number => {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '\n' && text[i + 1] === '\n') return -1
    if (c === '\\') {
      i++
    } else if (c === '[') {
      depth++
    } else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Parses `(destination "title")` starting at the `(` at `open`. Returns the
 * destination's offsets and the offset past `)`, or null when malformed.
 */
const parseParenthesized = (
  text: string,
  open: number
): { destStart: number; destEnd: number; end: number } | null => {
  let i = open + 1
  while (text[i] === ' ' || text[i] === '\t') i++
  const destStart = i
  if (text[i] === '<') {
    const close = text.indexOf('>', i)
    if (close === -1 || text.slice(i, close).includes('\n')) return null
    i = close + 1
  } else {
    let depth = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '\\') {
        i++
      } else if (c === '(') {
        depth++
      } else if (c === ')') {
        if (depth === 0) break
        depth--
      } else if (/\s/.test(c)) {
        break
      }
    }
  }
  const destEnd = i
  while (text[i] === ' ' || text[i] === '\t') i++
  const quote = text[i]
  if (quote === '"' || quote === "'" || quote === '(') {
    const close = text.indexOf(quote === '(' ? ')' : quote, i + 1)
    if (close === -1) return null
    i = close + 1
    while (text[i] === ' ' || text[i] === '\t') i++
  }
  if (text[i] !== ')') return null
  return { destStart, destEnd, end: i + 1 }
}

/**
 * Inline links and images (`[text](path)`, `![alt](path)`) addressing vault
 * files. `masked` locates syntax (code, math, HTML and wikilinks blanked out,
 * see maskDocument); destinations are read from `original`, which must have
 * the same length. Images nested in link text are reported as well.
 */
export const findMarkdownLinks = (masked: string, original: string): MarkdownLinkMatch[] => {
  const found: MarkdownLinkMatch[] = []
  let open = masked.indexOf('[')
  while (open !== -1) {
    const close = findLabelEnd(masked, open)
    const parsed = close !== -1 && masked[close + 1] === '(' ? parseParenthesized(masked, close + 1) : null
    if (parsed) {
      const embed = open > 0 && masked[open - 1] === '!'
      const destination = parseLinkDestination(original.slice(parsed.destStart, parsed.destEnd))
      if (destination) {
        found.push({ start: embed ? open - 1 : open, end: parsed.end, embed, destination })
      }
    }
    open = masked.indexOf('[', open + 1)
  }
  return found
}
