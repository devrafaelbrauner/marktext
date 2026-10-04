import { matchTag, matchWikilink, type ParsedWikilink } from 'common/markdownExt'
import { QueryError } from './errors'

export type Token =
  | { kind: 'number'; value: number; start: number; end: number }
  | { kind: 'string'; value: string; start: number; end: number }
  /** Names and keywords; keywords are recognised case-insensitively by the parser. */
  | { kind: 'identifier'; value: string; start: number; end: number }
  /** `#tag` without the `#`. */
  | { kind: 'tag'; value: string; start: number; end: number }
  | { kind: 'link'; value: ParsedWikilink; start: number; end: number }
  /** Unquoted `date(...)` / `dur(...)` literal; `value` is the text between the parentheses. */
  | { kind: 'dateLiteral' | 'durationLiteral'; value: string; start: number; end: number }
  | { kind: 'punct'; value: string; start: number; end: number }
  | { kind: 'eof'; value: ''; start: number; end: number }

const IDENTIFIER_START = /[\p{L}_\p{Extended_Pictographic}]/u
// Like Dataview, identifiers may contain `-` (`kanban-plugin`); subtraction needs spaces.
// ZWJ and VS16 (emoji sequences) sit outside the class: inside it they would combine with neighbours.
const IDENTIFIER_PART = /[\p{L}\p{M}\p{N}_\-\p{Extended_Pictographic}]|\u200D|\uFE0F/u
const NUMBER = /\d+(?:\.\d+)?/y
const TWO_CHAR_PUNCT: Record<string, true> = { '!=': true, '<=': true, '>=': true }
const ONE_CHAR_PUNCT: Record<string, true> = {
  '(': true,
  ')': true,
  '[': true,
  ']': true,
  ',': true,
  '.': true,
  '+': true,
  '-': true,
  '*': true,
  '/': true,
  '%': true,
  '!': true,
  '=': true,
  '<': true,
  '>': true,
  '&': true,
  '|': true
}
// Unquoted literal forms Dataview accepts: `date(today)`, `date(2026-10-04)`, `dur(3 days)`.
const LITERAL_CALL = /(date|dur)\s*\(([^()"\n]*)\)/iy
const DATE_LITERAL_BODY =
  /^\s*(?:today|now|tomorrow|yesterday|sow|eow|som|eom|soy|eoy|\d{4}-\d{2}(?:-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)?)\s*$/i
const DURATION_LITERAL_BODY = /^\s*\d+(?:\.\d+)?\s*[a-z]+(?:\s*,?\s*(?:and\s+)?\d+(?:\.\d+)?\s*[a-z]+)*\s*$/i

const readString = (text: string, start: number): { value: string; end: number } => {
  let value = ''
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i]
    if (char === '"') return { value, end: i + 1 }
    if (char === '\n') break
    if (char === '\\' && i + 1 < text.length) {
      const next = text[++i]
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next
      continue
    }
    value += char
  }
  throw new QueryError('unterminatedString', start)
}

const readIdentifier = (text: string, start: number): number => {
  let end = start
  for (const char of text.slice(start)) {
    if (!IDENTIFIER_PART.test(char)) break
    end += char.length
  }
  return end
}

/** Splits a query into tokens; throws `QueryError` with the offset of the offending character. */
export const tokenize = (text: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (/\s/.test(char)) {
      i++
      continue
    }
    if (char === '"') {
      const { value, end } = readString(text, i)
      tokens.push({ kind: 'string', value, start: i, end })
      i = end
      continue
    }
    if (/\d/.test(char)) {
      NUMBER.lastIndex = i
      const match = NUMBER.exec(text)
      const raw = match ? match[0] : char
      tokens.push({ kind: 'number', value: Number(raw), start: i, end: i + raw.length })
      i += raw.length
      continue
    }
    if (char === '[' && text[i + 1] === '[') {
      const match = matchWikilink(text.slice(i))
      if (!match) {
        if (text.indexOf(']]', i) === -1) throw new QueryError('unterminatedLink', i)
        throw new QueryError('invalidLink', i)
      }
      tokens.push({ kind: 'link', value: match.link, start: i, end: i + match.raw.length })
      i += match.raw.length
      continue
    }
    if (char === '#') {
      const match = matchTag(text.slice(i), text[i - 1])
      if (!match) throw new QueryError('invalidTag', i)
      tokens.push({ kind: 'tag', value: match.tag, start: i, end: i + match.raw.length })
      i += match.raw.length
      continue
    }
    const codePoint = String.fromCodePoint(text.codePointAt(i) ?? 0)
    if (IDENTIFIER_START.test(codePoint)) {
      LITERAL_CALL.lastIndex = i
      const literal = LITERAL_CALL.exec(text)
      if (literal) {
        const isDate = literal[1].toLowerCase() === 'date'
        if ((isDate ? DATE_LITERAL_BODY : DURATION_LITERAL_BODY).test(literal[2])) {
          const end = i + literal[0].length
          tokens.push({ kind: isDate ? 'dateLiteral' : 'durationLiteral', value: literal[2].trim(), start: i, end })
          i = end
          continue
        }
      }
      const end = readIdentifier(text, i)
      tokens.push({ kind: 'identifier', value: text.slice(i, end), start: i, end })
      i = end
      continue
    }
    const pair = text.slice(i, i + 2)
    if (TWO_CHAR_PUNCT[pair] === true) {
      tokens.push({ kind: 'punct', value: pair, start: i, end: i + 2 })
      i += 2
      continue
    }
    if (ONE_CHAR_PUNCT[char] === true) {
      tokens.push({ kind: 'punct', value: char, start: i, end: i + 1 })
      i++
      continue
    }
    throw new QueryError('invalidCharacter', i, { char: codePoint })
  }
  tokens.push({ kind: 'eof', value: '', start: text.length, end: text.length })
  return tokens
}
