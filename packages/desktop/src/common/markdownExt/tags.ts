/**
 * Obsidian-style `#tags`: letters (any script), marks, digits, `_`, `-`, `/`
 * (nesting) and emoji. A tag needs at least one letter or emoji, so `#2026`
 * and `#2026-10` are not tags.
 */
/**
 * Regular expression source (for the `u` flag) of one or more tag body
 * characters. ZWJ and VS16 (emoji sequences) sit outside the class: inside it
 * they would combine with neighbours.
 */
export const TAG_CHARS_SOURCE = '(?:[\\p{L}\\p{M}\\p{N}_\\-/\\p{Extended_Pictographic}]|\\u200D|\\uFE0F)+'
const TAG_AT_START = new RegExp(`^#(${TAG_CHARS_SOURCE})`, 'u')
const TAG_GLOBAL = new RegExp(`#(${TAG_CHARS_SOURCE})`, 'gu')
const HAS_LETTER = /[\p{L}\p{Extended_Pictographic}]/u
const HEX_COLOUR = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const BOUNDARY = /[\s\p{P}\p{S}]/u

/**
 * Whether a `#` preceded by `prev` (undefined or '' at the start of the
 * text) may open a tag: whitespace or punctuation, except `#` (headings,
 * `##x`), `&` (HTML entities), `\` (escapes), `/` (URL paths) and backtick.
 */
export const isTagBoundary = (prev: string | undefined): boolean => {
  if (!prev) return true
  if (prev === '#' || prev === '&' || prev === '\\' || prev === '/' || prev === '`') return false
  return BOUNDARY.test(prev)
}

/**
 * Body text after `#` that looks like a CSS colour rather than a tag:
 * 3/4/6/8 hex digits containing a decimal digit (`#1e1e1e`, `#f00`), 6/8 hex
 * letters (`#ffffff`) or 3/4 repetitions of one letter (`#fff`). Short
 * all-letter words such as `#cafe` or `#bad` remain tags.
 */
export const isHexColour = (body: string): boolean => {
  if (!HEX_COLOUR.test(body)) return false
  if (/\d/.test(body)) return true
  if (body.length >= 6) return true
  return new Set(body.toLowerCase()).size === 1
}

/**
 * Validates a tag written with or without its leading `#` and returns it
 * without `#` and trailing `/`, in original case; null when it is not a tag.
 */
export const normalizeTag = (raw: string): string | null => {
  const body = (raw.startsWith('#') ? raw.slice(1) : raw).replace(/\/+$/, '')
  if (!body || body.startsWith('/')) return null
  const match = TAG_AT_START.exec(`#${body}`)
  if (!match || match[1].length !== body.length) return null
  return HAS_LETTER.test(body) ? body : null
}

export interface TagMatch {
  /** Matched source text including `#` (and any trailing `/` that was dropped from `tag`). */
  raw: string
  tag: string
}

/**
 * Matches a body tag at the start of `src` for inline lexers. `prev` is the
 * character before `src` (undefined at the start of a block).
 */
export const matchTag = (src: string, prev: string | undefined): TagMatch | null => {
  if (!isTagBoundary(prev)) return null
  const match = TAG_AT_START.exec(src)
  if (!match) return null
  const tag = normalizeTag(match[1])
  if (!tag || isHexColour(tag)) return null
  return { raw: match[0], tag }
}

/**
 * Tags in text where code, math, links, URLs and HTML were already blanked
 * out with spaces (see maskDocument), with their UTF-16 offset of the `#`.
 */
export const findTags = (masked: string): Array<{ index: number; tag: string }> => {
  const found: Array<{ index: number; tag: string }> = []
  TAG_GLOBAL.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG_GLOBAL.exec(masked)) !== null) {
    const tagMatch = matchTag(match[0], masked[match.index - 1])
    if (tagMatch) found.push({ index: match.index, tag: tagMatch.tag })
  }
  return found
}
