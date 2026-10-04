/**
 * Value model of the query language. Values are plain, structured-cloneable
 * data so query results can travel from the index worker to the renderer
 * unchanged.
 */

export interface DateValue {
  type: 'date'
  /** Epoch milliseconds. */
  ms: number
  /** True for calendar dates without a time of day (`2026-10-04`, `date(today)`). */
  dateOnly: boolean
}

/**
 * A length of time. Months and days are calendar units (adding a month to
 * Jan 31 clamps to the end of February; adding a day keeps the wall-clock
 * time across DST changes); `ms` holds hours, minutes and seconds.
 */
export interface DurationValue {
  type: 'duration'
  months: number
  days: number
  ms: number
}

export interface LinkValue {
  type: 'link'
  /** Absolute path of the target when resolved, otherwise the target as written. */
  path: string
  /** Text to show instead of the target's file name. */
  display: string | null
  /** Heading, block (`^id`) or file subpath after `#`. */
  subpath: string | null
  embed: boolean
  resolved: boolean
}

export interface ObjectValue {
  type: 'object'
  entries: Record<string, Value>
}

export type Value =
  | null
  | boolean
  | number
  | string
  | DateValue
  | DurationValue
  | LinkValue
  | ObjectValue
  | Value[]

export type ValueType = 'null' | 'boolean' | 'number' | 'string' | 'date' | 'duration' | 'link' | 'array' | 'object'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

export const typeOf = (value: Value): ValueType => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'boolean':
      return 'boolean'
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    default:
      return value.type
  }
}

export const makeDate = (ms: number, dateOnly: boolean): DateValue => ({ type: 'date', ms, dateOnly })
export const makeDuration = (months: number, days: number, ms: number): DurationValue => ({
  type: 'duration',
  months,
  days,
  ms
})

/** Object value whose keys are own properties even when named `__proto__`. */
export const makeObject = (entries: Iterable<[string, Value]>): ObjectValue => {
  const record: Record<string, Value> = {}
  for (const [key, value] of entries) setEntry(record, key, value)
  return { type: 'object', entries: record }
}

export const setEntry = (record: Record<string, Value>, key: string, value: Value): void => {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true })
}

export const hasEntry = (record: Record<string, Value>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

/** Field name as Dataview compares it: lower case, whitespace runs as `-`. */
const canonicalKey = (key: string): string => key.trim().toLowerCase().replace(/\s+/g, '-')

/**
 * Reads a field the way Dataview does: the exact key first, then any key
 * equal after lower-casing and turning spaces into dashes (`Due Date` is
 * reachable as `due-date`). Missing fields are null.
 */
export const getField = (object: ObjectValue, name: string): Value => {
  const { entries } = object
  if (hasEntry(entries, name)) return entries[name]
  const wanted = canonicalKey(name)
  for (const key of Object.keys(entries)) {
    if (canonicalKey(key) === wanted) return entries[key]
  }
  return null
}

/** Dataview truthiness: null, false, 0, '' and empty lists/objects are false. */
export const isTruthy = (value: Value): boolean => {
  if (value === null) return false
  if (Array.isArray(value)) return value.length > 0
  switch (typeof value) {
    case 'boolean':
      return value
    case 'number':
      return value !== 0 && !Number.isNaN(value)
    case 'string':
      return value.length > 0
    default:
      return value.type === 'object' ? Object.keys(value.entries).length > 0 : true
  }
}

// ---------------------------------------------------------------------------
// Dates and durations
// ---------------------------------------------------------------------------

const ISO_DATE =
  /^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?)?$/

/** Parses `YYYY-MM`, `YYYY-MM-DD` or an ISO date-time (local time unless it carries a zone); null when invalid. */
export const parseDateText = (text: string): DateValue | null => {
  const match = ISO_DATE.exec(text.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, frac, zone] = match
  const year = Number(y)
  const month = Number(mo) - 1
  const day = d ? Number(d) : 1
  const hour = h ? Number(h) : 0
  const minute = mi ? Number(mi) : 0
  const second = s ? Number(s) : 0
  const milli = frac ? Number(frac.padEnd(3, '0')) : 0
  if (month > 11 || day < 1 || hour > 23 || minute > 59 || second > 59) return null
  const probe = new Date(Date.UTC(year, month, day))
  if (probe.getUTCMonth() !== month || probe.getUTCDate() !== day) return null
  if (zone) {
    let offset = 0
    if (zone !== 'Z') {
      const sign = zone.startsWith('-') ? -1 : 1
      const digits = zone.slice(1).replace(':', '')
      offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)))
    }
    return makeDate(Date.UTC(year, month, day, hour, minute, second, milli) - offset * MINUTE_MS, false)
  }
  const date = new Date(year, month, day, hour, minute, second, milli)
  date.setFullYear(year)
  return makeDate(date.getTime(), h === undefined)
}

const startOfDay = (ms: number): Date => {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date
}

/** `today`, `now`, `tomorrow`, … relative to `now` (epoch ms); null for other words. */
export const relativeDate = (keyword: string, now: number): DateValue | null => {
  const day = startOfDay(now)
  const endOf = (date: Date): DateValue => makeDate(date.getTime() - 1, false)
  switch (keyword.toLowerCase()) {
    case 'now':
      return makeDate(now, false)
    case 'today':
      return makeDate(day.getTime(), true)
    case 'tomorrow':
      day.setDate(day.getDate() + 1)
      return makeDate(day.getTime(), true)
    case 'yesterday':
      day.setDate(day.getDate() - 1)
      return makeDate(day.getTime(), true)
    case 'sow':
    case 'eow': {
      // ISO weeks start on Monday.
      day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
      if (keyword.toLowerCase() === 'sow') return makeDate(day.getTime(), true)
      day.setDate(day.getDate() + 7)
      return endOf(day)
    }
    case 'som':
    case 'eom':
      day.setDate(1)
      if (keyword.toLowerCase() === 'som') return makeDate(day.getTime(), true)
      day.setMonth(day.getMonth() + 1)
      return endOf(day)
    case 'soy':
    case 'eoy':
      day.setMonth(0, 1)
      if (keyword.toLowerCase() === 'soy') return makeDate(day.getTime(), true)
      day.setFullYear(day.getFullYear() + 1)
      return endOf(day)
    default:
      return null
  }
}

type DurationUnit = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds'

const UNIT_ALIASES: Record<string, DurationUnit> = {
  y: 'years',
  yr: 'years',
  yrs: 'years',
  year: 'years',
  years: 'years',
  mo: 'months',
  mos: 'months',
  month: 'months',
  months: 'months',
  w: 'weeks',
  wk: 'weeks',
  wks: 'weeks',
  week: 'weeks',
  weeks: 'weeks',
  d: 'days',
  day: 'days',
  days: 'days',
  h: 'hours',
  hr: 'hours',
  hrs: 'hours',
  hour: 'hours',
  hours: 'hours',
  m: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  minute: 'minutes',
  minutes: 'minutes',
  s: 'seconds',
  sec: 'seconds',
  secs: 'seconds',
  second: 'seconds',
  seconds: 'seconds'
}

const DURATION_PART = /(\d+(?:\.\d+)?)\s*([a-z]+)\s*(?:,\s*|and\s+)?/giy

/** Parses `3 days`, `1 month, 2 weeks`, `1h 30m`; null when any part is not `<number> <unit>`. */
export const parseDurationText = (text: string): DurationValue | null => {
  const source = text.trim()
  if (!source) return null
  let months = 0
  let days = 0
  let ms = 0
  DURATION_PART.lastIndex = 0
  let consumed = 0
  let match: RegExpExecArray | null
  while (consumed < source.length && (match = DURATION_PART.exec(source)) !== null) {
    consumed = DURATION_PART.lastIndex
    const amount = Number(match[1])
    const unit = UNIT_ALIASES[match[2].toLowerCase()]
    if (!unit) return null
    if ((unit === 'years' || unit === 'months') && !Number.isInteger(amount)) return null
    switch (unit) {
      case 'years':
        months += amount * 12
        break
      case 'months':
        months += amount
        break
      case 'weeks':
      case 'days': {
        const total = unit === 'weeks' ? amount * 7 : amount
        const whole = Math.trunc(total)
        days += whole
        ms += Math.round((total - whole) * DAY_MS)
        break
      }
      case 'hours':
        ms += amount * HOUR_MS
        break
      case 'minutes':
        ms += amount * MINUTE_MS
        break
      case 'seconds':
        ms += amount * 1000
        break
    }
  }
  return consumed === source.length ? makeDuration(months, days, ms) : null
}

const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate()

/** `date + sign * duration` with calendar months (clamped to the month end) and days. */
export const addDuration = (date: DateValue, duration: DurationValue, sign: 1 | -1): DateValue => {
  const result = new Date(date.ms)
  if (duration.months) {
    const total = result.getMonth() + sign * duration.months
    const year = result.getFullYear() + Math.floor(total / 12)
    const month = ((total % 12) + 12) % 12
    const day = Math.min(result.getDate(), daysInMonth(year, month))
    result.setFullYear(year, month, day)
  }
  if (duration.days) result.setDate(result.getDate() + sign * duration.days)
  return makeDate(result.getTime() + sign * duration.ms, date.dateOnly && duration.ms === 0)
}

const localDayNumber = (ms: number): number => {
  const date = new Date(ms)
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

/** `a - b`: whole days between calendar dates, otherwise milliseconds. */
export const subtractDates = (a: DateValue, b: DateValue): DurationValue => {
  if (a.dateOnly && b.dateOnly) return makeDuration(0, localDayNumber(a.ms) - localDayNumber(b.ms), 0)
  return makeDuration(0, 0, a.ms - b.ms)
}

/** Approximate length for ordering (a month counts 30 days). */
const durationToMs = (duration: DurationValue): number =>
  (duration.months * 30 + duration.days) * DAY_MS + duration.ms

export const scaleDuration = (duration: DurationValue, factor: number): DurationValue => {
  const months = duration.months * factor
  const days = duration.days * factor
  const wholeMonths = Math.trunc(months)
  const wholeDays = Math.trunc(days)
  return makeDuration(
    wholeMonths,
    wholeDays + Math.round((months - wholeMonths) * 30),
    duration.ms * factor + Math.round((days - wholeDays) * DAY_MS)
  )
}

export const addDurations = (a: DurationValue, b: DurationValue, sign: 1 | -1): DurationValue =>
  makeDuration(a.months + sign * b.months, a.days + sign * b.days, a.ms + sign * b.ms)

/** Duration split into display units, largest first, zero parts omitted. */
export const durationParts = (duration: DurationValue): Array<{ unit: DurationUnit; amount: number }> => {
  const negative = durationToMs(duration) < 0
  const sign = negative ? -1 : 1
  const months = Math.abs(duration.months)
  let rest = Math.abs(duration.ms)
  const parts: Array<{ unit: DurationUnit; amount: number }> = []
  const push = (unit: DurationUnit, amount: number): void => {
    if (amount) parts.push({ unit, amount: sign * amount })
  }
  push('years', Math.floor(months / 12))
  push('months', months % 12)
  const days = Math.abs(duration.days) + Math.floor(rest / DAY_MS)
  rest %= DAY_MS
  push('days', days)
  push('hours', Math.floor(rest / HOUR_MS))
  rest %= HOUR_MS
  push('minutes', Math.floor(rest / MINUTE_MS))
  rest %= MINUTE_MS
  push('seconds', rest / 1000)
  return parts
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

/** ISO text in local time: `2026-10-04` or `2026-10-04T13:05:00`. */
const formatIsoDate = (date: DateValue): string => {
  const d = new Date(date.ms)
  const day = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (date.dateOnly) return day
  return `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ---------------------------------------------------------------------------
// Ordering and text conversion
// ---------------------------------------------------------------------------

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Total order used by comparisons, `=` and SORT, as in Dataview: null sorts
 * first, values of different types are ordered by type name, links by
 * target path, lists element-wise.
 */
export const compareValues = (a: Value, b: Value): number => {
  const ta = typeOf(a)
  const tb = typeOf(b)
  if (ta === 'null' && tb === 'null') return 0
  if (ta === 'null') return -1
  if (tb === 'null') return 1
  if (ta !== tb) return compareStrings(ta, tb)
  switch (ta) {
    case 'boolean':
    case 'number':
      return Number(a) - Number(b)
    case 'string':
      return compareStrings(a as string, b as string)
    case 'date':
      return (a as DateValue).ms - (b as DateValue).ms
    case 'duration':
      return durationToMs(a as DurationValue) - durationToMs(b as DurationValue)
    case 'link': {
      const la = a as LinkValue
      const lb = b as LinkValue
      return compareStrings(la.path, lb.path) || compareStrings(la.subpath ?? '', lb.subpath ?? '')
    }
    case 'array': {
      const la = a as Value[]
      const lb = b as Value[]
      for (let i = 0; i < Math.min(la.length, lb.length); i++) {
        const result = compareValues(la[i], lb[i])
        if (result !== 0) return result
      }
      return la.length - lb.length
    }
    default: {
      const ea = (a as ObjectValue).entries
      const eb = (b as ObjectValue).entries
      const ka = Object.keys(ea).sort()
      const kb = Object.keys(eb).sort()
      const keyOrder = compareValues(ka, kb)
      if (keyOrder !== 0) return keyOrder
      for (const key of ka) {
        const result = compareValues(ea[key], eb[key])
        if (result !== 0) return result
      }
      return 0
    }
  }
}

export const valuesEqual = (a: Value, b: Value): boolean => compareValues(a, b) === 0

const fileStem = (path: string): string => {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return name.replace(/\.md$/i, '')
}

/** Text shown for a link: its alias, else the target file name without `.md`. */
export const linkText = (link: LinkValue): string => {
  if (link.display) return link.display
  const stem = link.resolved ? fileStem(link.path) : link.path
  return link.subpath ? `${stem} > ${link.subpath}` : stem
}

const ENGLISH_UNITS: Record<DurationUnit, [string, string]> = {
  years: ['year', 'years'],
  months: ['month', 'months'],
  weeks: ['week', 'weeks'],
  days: ['day', 'days'],
  hours: ['hour', 'hours'],
  minutes: ['minute', 'minutes'],
  seconds: ['second', 'seconds']
}

/** Plain-text form used by `string()` and string concatenation (locale independent). */
export const valueToString = (value: Value): string => {
  switch (typeOf(value)) {
    case 'null':
      return 'null'
    case 'boolean':
    case 'number':
    case 'string':
      return String(value)
    case 'date':
      return formatIsoDate(value as DateValue)
    case 'duration': {
      const parts = durationParts(value as DurationValue)
      if (parts.length === 0) return '0 seconds'
      return parts
        .map(({ unit, amount }) => `${amount} ${ENGLISH_UNITS[unit][Math.abs(amount) === 1 ? 0 : 1]}`)
        .join(', ')
    }
    case 'link':
      return linkText(value as LinkValue)
    case 'array':
      return (value as Value[]).map(valueToString).join(', ')
    default:
      return `{ ${Object.entries((value as ObjectValue).entries)
        .map(([key, entry]) => `${key}: ${valueToString(entry)}`)
        .join(', ')} }`
  }
}
