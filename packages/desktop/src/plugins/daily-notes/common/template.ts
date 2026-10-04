import type { ManipulateType } from 'dayjs/esm'
import { DEFAULT_DATE_FORMAT } from './constants'
import type { Dayjs } from './dates'

export interface TemplateContext {
  /** Day of the note. */
  date: Dayjs
  /** Current moment; its time of day is used for `{{time}}` and offsets in hours/minutes/seconds. */
  now: Dayjs
  /** The daily note format setting, used by `{{date}}`, `{{yesterday}}`, `{{tomorrow}}`. */
  format: string
  /** File name of the note without extension. */
  title: string
  locale: string
}

// Same placeholder grammar as Obsidian's daily notes: optional spaces inside
// the braces, an optional `±N<unit>` offset and an optional `:FORMAT`.
const PLACEHOLDER = /\{\{\s*(date|time|title|yesterday|tomorrow)\s*(?:([+-]\d+)([yqmwdhs]))?\s*(?::([^}\n]+))?\}\}/gi

// moment duration units as Obsidian passes them: `M` is months, `m` minutes.
const offsetUnit = (unit: string): ManipulateType => {
  if (unit === 'M') return 'month'
  if (unit === 'm') return 'minute'
  switch (unit.toLowerCase()) {
    case 'y':
      return 'year'
    case 'w':
      return 'week'
    case 'd':
      return 'day'
    case 'h':
      return 'hour'
    default:
      return 'second'
  }
}

/**
 * Fills a daily note template: `{{date}}`, `{{date:FORMAT}}`, `{{time}}`
 * (`HH:mm`), `{{time:FORMAT}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`,
 * with Obsidian's `{{date+1d:FORMAT}}` offsets. Placeholders it does not know,
 * or known ones with parts they do not take (`{{title:X}}`), stay as written.
 */
export const renderTemplate = (template: string, context: TemplateContext): string => {
  const format = context.format || DEFAULT_DATE_FORMAT
  const moment = context.date
    .hour(context.now.hour())
    .minute(context.now.minute())
    .second(context.now.second())
    .locale(context.locale)
  return template.replace(
    PLACEHOLDER,
    (match, name: string, amount: string | undefined, unit: string | undefined, custom: string | undefined) => {
      const kind = name.toLowerCase()
      if (kind === 'date' || kind === 'time') {
        let value = moment
        if (amount && unit) {
          // Quarters are not a dayjs manipulate unit without a plugin; three months is the same step.
          value = unit.toLowerCase() === 'q' ? value.add(Number(amount) * 3, 'month') : value.add(Number(amount), offsetUnit(unit))
        }
        return value.format(custom ?? (kind === 'date' ? format : 'HH:mm'))
      }
      if (amount || custom !== undefined) return match
      if (kind === 'title') return context.title
      return moment.add(kind === 'yesterday' ? -1 : 1, 'day').format(format)
    }
  )
}
