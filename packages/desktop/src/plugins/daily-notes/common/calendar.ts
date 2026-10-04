import type { DateKey } from './dates'

export type WeekStart = 'sunday' | 'monday'

export interface CalendarCell {
  key: DateKey
  year: number
  /** 0-11. */
  month: number
  /** Day of the month, 1-31. */
  day: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** False for the leading/trailing days of the neighbouring months. */
  inMonth: boolean
}

const DAY_MS = 86_400_000
export const CALENDAR_WEEKS = 6

const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

// Calendar arithmetic runs on UTC timestamps: UTC has no DST, so adding whole
// days never skips or repeats a date.
const utcKey = (time: number): DateKey => {
  const date = new Date(time)
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

const keyToUtc = (key: DateKey): number => {
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

const weekStartIndex = (weekStart: WeekStart): number => (weekStart === 'monday' ? 1 : 0)

/** Weekday numbers (0 = Sunday) in display order. */
export const weekdayOrder = (weekStart: WeekStart): number[] =>
  Array.from({ length: 7 }, (_, index) => (index + weekStartIndex(weekStart)) % 7)

/** Six full weeks starting on `weekStart` that contain the whole of `month` (0-11) of `year`. */
export const buildMonthGrid = (year: number, month: number, weekStart: WeekStart): CalendarCell[] => {
  const first = Date.UTC(year, month, 1)
  const leading = (new Date(first).getUTCDay() - weekStartIndex(weekStart) + 7) % 7
  const start = first - leading * DAY_MS
  return Array.from({ length: CALENDAR_WEEKS * 7 }, (_, index) => {
    const time = start + index * DAY_MS
    const date = new Date(time)
    return {
      key: utcKey(time),
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
      weekday: date.getUTCDay(),
      inMonth: date.getUTCMonth() === month && date.getUTCFullYear() === year
    }
  })
}

export const addDays = (key: DateKey, days: number): DateKey => utcKey(keyToUtc(key) + days * DAY_MS)

/**
 * Same day of the month `months` months away, clamped to the last day of the
 * target month (31 Jan + 1 month = 28/29 Feb).
 */
export const addMonths = (key: DateKey, months: number): DateKey => {
  const [year, month, day] = key.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return utcKey(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)))
}

/** First (`edge` 'start') or last ('end') day of the week containing `key`. */
export const weekEdge = (key: DateKey, weekStart: WeekStart, edge: 'start' | 'end'): DateKey => {
  const offset = (new Date(keyToUtc(key)).getUTCDay() - weekStartIndex(weekStart) + 7) % 7
  return addDays(key, edge === 'start' ? -offset : 6 - offset)
}

/** `{ year, month }` of the month containing `key`. */
export const monthOf = (key: DateKey): { year: number; month: number } => {
  const [year, month] = key.split('-').map(Number)
  return { year, month: month - 1 }
}

/** Dot size step 1-4 for a note of `wordCount` words. */
export const dotLevel = (wordCount: number): 1 | 2 | 3 | 4 => {
  if (wordCount < 50) return 1
  if (wordCount < 250) return 2
  if (wordCount < 750) return 3
  return 4
}

/** BCP 47 tag for an app UI language code (`pt` is Brazilian Portuguese in this app). */
export const toIntlLocale = (language: string): string => (language === 'pt' ? 'pt-BR' : language)

const capitalize = (text: string, locale: string): string =>
  text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text

/** Month and year heading, e.g. "October 2026" / "Outubro de 2026". */
export const formatMonthTitle = (year: number, month: number, language: string): string => {
  const locale = toIntlLocale(language)
  const text = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month, 1))
  )
  return capitalize(text, locale)
}

/** Weekday names in display order: `short` without abbreviation dots ("Dom"), `long` for tooltips. */
export const formatWeekdays = (weekStart: WeekStart, language: string): Array<{ short: string; long: string }> => {
  const locale = toIntlLocale(language)
  const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  // 2023-01-01 was a Sunday, so day N of that week has weekday N.
  return weekdayOrder(weekStart).map((weekday) => {
    const date = new Date(Date.UTC(2023, 0, 1 + weekday))
    return {
      short: capitalize(short.format(date).replace(/\.$/, ''), locale),
      long: capitalize(long.format(date), locale)
    }
  })
}

/** Full spoken date for screen readers, e.g. "Sunday, October 4, 2026". */
export const formatFullDate = (key: DateKey, language: string): string => {
  const locale = toIntlLocale(language)
  return capitalize(
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(keyToUtc(key))),
    locale
  )
}
