/**
 * Dataview-style inline fields: a whole line `key:: value` (also after a
 * list marker, task checkbox or blockquote marker) and embedded
 * `[key:: value]` / `(key:: value)`.
 */

export type InlineFieldValue = string | number | boolean | null

export interface InlineFieldMatch {
  /** Lower-cased, trimmed key with surrounding `*`/`_` emphasis removed. */
  key: string
  value: InlineFieldValue
  /** UTF-16 offset of the field start within the scanned line. */
  start: number
}

const NUMBER = /^-?\d+(?:\.\d+)?$/
const LINE_FIELD = /^([^[\]()`:\s][^[\]()`:]*?)::(?!:)[ \t]*(.*)$/
const BRACKET_FIELD_OPEN = /[[(]([^[\]()`:\n]+?)::(?!:)/g

/**
 * Types a raw value: '' → null, `true`/`false` (any case) → boolean, plain
 * decimal numbers → number; everything else (ISO dates, `[[links]]`, quoted
 * text) stays the trimmed string.
 */
export const parseInlineFieldValue = (raw: string): InlineFieldValue => {
  const value = raw.trim()
  if (!value) return null
  const lower = value.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  if (NUMBER.test(value)) return Number(value)
  return value
}

/** Normalized field key, or null when nothing but emphasis markers remains. */
export const normalizeFieldKey = (raw: string): string | null => {
  const key = raw.trim().replace(/^[*_]+|[*_]+$/g, '').trim().toLowerCase()
  return key || null
}

/** Parses `text` as a whole-line field (`key:: value`); `text` must already be stripped of list/task/quote markers. */
export const matchLineField = (text: string): { key: string; value: InlineFieldValue } | null => {
  const match = LINE_FIELD.exec(text)
  if (!match) return null
  const key = normalizeFieldKey(match[1])
  return key ? { key, value: parseInlineFieldValue(match[2]) } : null
}

/**
 * Embedded `[key:: value]` and `(key:: value)` fields of one line. `masked`
 * (code blanked, same length as `original`) locates them; values are read
 * from `original` up to the bracket that balances the opener, so values may
 * contain `[[wikilinks]]`. Unclosed fields are ignored.
 */
export const findBracketFields = (masked: string, original: string): InlineFieldMatch[] => {
  const found: InlineFieldMatch[] = []
  BRACKET_FIELD_OPEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BRACKET_FIELD_OPEN.exec(masked)) !== null) {
    const start = match.index
    const opener = masked[start]
    const closer = opener === '[' ? ']' : ')'
    // `[[note::x]]` is a wikilink, not a field.
    if (opener === '[' && masked[start - 1] === '[') continue
    let depth = 1
    let end = -1
    for (let i = start + match[0].length; i < masked.length; i++) {
      if (masked[i] === opener) depth++
      else if (masked[i] === closer && --depth === 0) {
        end = i
        break
      }
    }
    const key = normalizeFieldKey(match[1])
    if (end === -1 || !key) continue
    found.push({ key, value: parseInlineFieldValue(original.slice(start + match[0].length, end)), start })
    BRACKET_FIELD_OPEN.lastIndex = end + 1
  }
  return found
}

/**
 * Adds a field to a record; a repeated key turns the stored value into an
 * array of all values in order. Keys are defined as own properties, so a
 * `__proto__:: x` field cannot alter the record's prototype.
 */
export const addInlineField = (fields: Record<string, unknown>, key: string, value: InlineFieldValue): void => {
  let next: unknown = value
  if (Object.prototype.hasOwnProperty.call(fields, key)) {
    const existing = fields[key]
    next = Array.isArray(existing) ? [...existing, value] : [existing, value]
  }
  Object.defineProperty(fields, key, { value: next, enumerable: true, writable: true, configurable: true })
}
