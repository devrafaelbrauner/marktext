/**
 * Card metadata Obsidian Kanban recognises inside card text: wikilinks,
 * `#tags`, dates (`@{2026-10-04}`, `@[[2026-10-04]]`) and times
 * (`@@{10:30}`). The `@`/`@@` triggers come from the board settings
 * (`date-trigger`, `time-trigger`).
 */
import { matchTag, matchWikilink, type ParsedWikilink } from 'common/markdownExt'

export const DEFAULT_DATE_TRIGGER = '@'
export const DEFAULT_TIME_TRIGGER = '@@'

export type CardToken =
  | { type: 'wikilink'; link: ParsedWikilink }
  | { type: 'tag'; tag: string }
  /** `link` is set for the `@[[date]]` form, which links to the daily note. */
  | { type: 'date'; date: string; link: ParsedWikilink | null }
  | { type: 'time'; time: string }

export interface CardTokenMatch {
  /** UTF-16 offsets into the card text. */
  start: number
  end: number
  token: CardToken
}

export interface CardTriggers {
  dateTrigger: string
  timeTrigger: string
}

export const getTriggers = (settings: Record<string, unknown>): CardTriggers => {
  const date = settings['date-trigger']
  const time = settings['time-trigger']
  return {
    dateTrigger: typeof date === 'string' && date ? date : DEFAULT_DATE_TRIGGER,
    timeTrigger: typeof time === 'string' && time ? time : DEFAULT_TIME_TRIGGER
  }
}

const matchBraced = (src: string, open: string): { length: number; value: string } | null => {
  if (!src.startsWith(open)) return null
  const close = src.indexOf('}', open.length)
  const newline = src.indexOf('\n', open.length)
  if (close === -1 || (newline !== -1 && newline < close)) return null
  const value = src.slice(open.length, close).trim()
  return value ? { length: close + 1, value } : null
}

/** Length of a construct to skip at `src` start: code span, link destination, autolink or HTML tag. */
const skipLength = (src: string): number => {
  if (src[0] === '`') {
    const run = /^`+/.exec(src)?.[0] ?? '`'
    const close = src.indexOf(run, run.length)
    return close === -1 ? run.length : close + run.length
  }
  if (src.startsWith('](')) {
    const close = src.indexOf(')', 2)
    return close === -1 ? 0 : close + 1
  }
  const tag = /^<[a-zA-Z/!][^>\n]*>/.exec(src) ?? /^https?:\/\/[^\s<>]+/.exec(src)
  return tag ? tag[0].length : 0
}

/** Tokens of `text` in order, outside code spans, link destinations, URLs and HTML tags. */
export const findCardTokens = (text: string, triggers: CardTriggers): CardTokenMatch[] => {
  const matches: CardTokenMatch[] = []
  // A longer trigger first, so `@@{…}` is a time and not `@` + `@{…}`.
  const braced = [
    { open: `${triggers.timeTrigger}{`, type: 'time' as const },
    { open: `${triggers.dateTrigger}{`, type: 'date' as const }
  ].sort((a, b) => b.open.length - a.open.length)

  let i = 0
  while (i < text.length) {
    const src = text.slice(i)
    const skip = skipLength(src)
    if (skip > 0) {
      i += skip
      continue
    }

    let found: { length: number; token: CardToken } | null = null
    for (const { open, type } of braced) {
      const match = matchBraced(src, open)
      if (match) {
        found = {
          length: match.length,
          token: type === 'time' ? { type, time: match.value } : { type, date: match.value, link: null }
        }
        break
      }
    }
    if (!found && src.startsWith(`${triggers.dateTrigger}[[`)) {
      const link = matchWikilink(src.slice(triggers.dateTrigger.length))
      if (link && !link.link.embed && link.link.target) {
        found = {
          length: triggers.dateTrigger.length + link.raw.length,
          token: { type: 'date', date: link.link.target, link: link.link }
        }
      }
    }
    if (!found && (src[0] === '[' || src.startsWith('![['))) {
      const link = matchWikilink(src)
      if (link) found = { length: link.raw.length, token: { type: 'wikilink', link: link.link } }
    }
    if (!found && src[0] === '#') {
      const tag = matchTag(src, i > 0 ? text[i - 1] : undefined)
      if (tag) found = { length: tag.raw.length, token: { type: 'tag', tag: tag.tag } }
    }

    if (found) {
      matches.push({ start: i, end: i + found.length, token: found.token })
      i += found.length
    } else {
      i++
    }
  }
  return matches
}

/** `YYYY-MM-DD` as a local date, or null for anything else (custom Obsidian date formats stay text). */
export const parseIsoDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getMonth() === Number(match[2]) - 1 ? date : null
}
