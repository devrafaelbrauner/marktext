import dayjs, { type Dayjs } from 'dayjs/esm'
import advancedFormat from 'dayjs/esm/plugin/advancedFormat'
import customParseFormat from 'dayjs/esm/plugin/customParseFormat'
import isoWeek from 'dayjs/esm/plugin/isoWeek'
import weekOfYear from 'dayjs/esm/plugin/weekOfYear'
import weekYear from 'dayjs/esm/plugin/weekYear'
import 'dayjs/esm/locale/pt-br'
import { DEFAULT_DATE_FORMAT } from './constants'

// Formatting tokens Obsidian users rely on (moment syntax): `Do`, `Q`, `ww`,
// `gggg`, `WW`, `GGGG` come from these plugins; parsing needs customParseFormat.
dayjs.extend(advancedFormat)
dayjs.extend(customParseFormat)
dayjs.extend(isoWeek)
dayjs.extend(weekOfYear)
dayjs.extend(weekYear)

export { dayjs }
export type { Dayjs }

/** Calendar day as `YYYY-MM-DD`; the identity of a daily note independent of the configured format. */
export type DateKey = string

/** Where daily notes live and how their names are written. */
export interface DailyNoteLocation {
  /** Vault-relative folder ('' = vault root). */
  folder: string
  /** dayjs/moment format; may contain `/` to nest notes in folders (`YYYY/MM/YYYY-MM-DD`). */
  format: string
  /** dayjs locale used for localized tokens such as `MMMM` or `dddd`. */
  locale: string
}

/** dayjs locale for an app UI language: Brazilian Portuguese for `pt`, English otherwise. */
export const toDayjsLocale = (language: string): string =>
  language === 'pt' || language.startsWith('pt-') ? 'pt-br' : 'en'

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for an existing calendar day written as `YYYY-MM-DD`. */
export const isDateKey = (value: string): boolean => {
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * Local midnight of `key`. Built from the Date constructor so a day whose
 * midnight is skipped by a DST change still lands on that day.
 */
export const keyToDate = (key: DateKey): Dayjs => {
  const [year, month, day] = key.split('-').map(Number)
  return dayjs(new Date(year, month - 1, day))
}

export const dateToKey = (date: Dayjs): DateKey => date.format('YYYY-MM-DD')

export const formatDate = (date: Dayjs, format: string, locale: string): string =>
  date.locale(locale).format(format || DEFAULT_DATE_FORMAT)

/**
 * Reads a date written with `format`. The parse is lenient (customParseFormat
 * skips tokens it cannot read, such as day names) but the result only counts
 * when formatting it again reproduces `input` exactly, so `2026-02-30` or a
 * folder that disagrees with the file name never yields a date.
 */
export const parseDate = (input: string, format: string, locale: string): DateKey | null => {
  const effective = format || DEFAULT_DATE_FORMAT
  const parsed = dayjs(input, effective, locale)
  if (!parsed.isValid()) return null
  return parsed.locale(locale).format(effective) === input ? dateToKey(parsed) : null
}

/**
 * Path segments of `path` (either separator) with `.` dropped and `..`
 * applied; `..` never climbs above the start, so the result stays inside the
 * vault.
 */
export const toSegments = (path: string): string[] => {
  const segments: string[] = []
  for (const segment of path.split(/[\\/]+/)) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments
}

/** Vault-relative folder normalized to `a/b` ('' for the vault root). */
export const normalizeFolder = (folder: string): string => toSegments(folder.trim()).join('/')

/**
 * Vault-relative path (`/`-separated, with `.md`) of the daily note of `date`,
 * or null when the format produces an empty name.
 */
export const dailyNoteRelativePath = (date: Dayjs, location: DailyNoteLocation): string | null => {
  const name = toSegments(formatDate(date, location.format, location.locale)).filter((segment) => segment.trim())
  if (name.length === 0) return null
  return [...toSegments(normalizeFolder(location.folder)), ...name].join('/') + '.md'
}

/** File name without extension of a vault-relative or absolute path. */
export const basenameOf = (path: string): string => {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Joins a vault-relative `/` path to the absolute root, using the root's separator. */
export const joinRoot = (root: string, relativePath: string): string => {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')
  return base + separator + toSegments(relativePath).join(separator)
}

/** `/`-separated path of `path` relative to `root`, or null when it is not inside it. */
export const relativeToRoot = (root: string, path: string): string | null => {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const target = path.replace(/\\/g, '/')
  if (!target.startsWith(base + '/')) return null
  const relative = target.slice(base.length + 1)
  return relative || null
}

/**
 * Vault-relative path of the template note; `.md` is added when missing, as
 * Obsidian's template setting accepts `Templates/Daily`. Null when empty.
 */
export const templateRelativePath = (template: string): string | null => {
  const segments = toSegments(template.trim())
  if (segments.length === 0) return null
  const last = segments[segments.length - 1]
  if (!/\.md$/i.test(last)) segments[segments.length - 1] = `${last}.md`
  return segments.join('/')
}
