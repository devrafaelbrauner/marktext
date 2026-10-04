import { matchWikilink, type ParsedWikilink } from 'common/markdownExt'
import type { QueryErrorInfo } from '../common/errors'
import type { QueryResult } from '../common/engine'
import {
  durationParts,
  linkText,
  typeOf,
  type DateValue,
  type DurationValue,
  type LinkValue,
  type ObjectValue,
  type Value
} from '../common/values'

/** Shown for null and empty values, like Dataview. */
export const EMPTY_VALUE = '-'

/** BCP 47 locale for an app UI language code (`pt` is Brazilian Portuguese). */
export const toIntlLocale = (language: string): string => (language === 'pt' ? 'pt-BR' : language)

const UNIT_NAMES = {
  years: 'year',
  months: 'month',
  weeks: 'week',
  days: 'day',
  hours: 'hour',
  minutes: 'minute',
  seconds: 'second'
} as const

export const formatDate = (date: DateValue, locale: string): string =>
  new Intl.DateTimeFormat(
    locale,
    date.dateOnly
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  ).format(new Date(date.ms))

/** `2 days, 3 hours` in the UI language; zero is `0 seconds`. */
export const formatDuration = (duration: DurationValue, locale: string): string => {
  const parts = durationParts(duration)
  if (parts.length === 0) parts.push({ unit: 'seconds', amount: 0 })
  return parts
    .map(({ unit, amount }) =>
      new Intl.NumberFormat(locale, { style: 'unit', unit: UNIT_NAMES[unit], unitDisplay: 'long', maximumFractionDigits: 3 }).format(amount)
    )
    .join(', ')
}

/** Text of a scalar value; lists and objects are joined with `, `. */
export const formatValueText = (value: Value, locale: string): string => {
  switch (typeOf(value)) {
    case 'null':
      return EMPTY_VALUE
    case 'number':
      // Localized decimal separator, no digit grouping (numbers read like the source).
      return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 6 }).format(value as number)
    case 'boolean':
      return String(value)
    case 'string':
      return (value as string) || EMPTY_VALUE
    case 'date':
      return formatDate(value as DateValue, locale)
    case 'duration':
      return formatDuration(value as DurationValue, locale)
    case 'link':
      return linkText(value as LinkValue)
    case 'array': {
      const items = value as Value[]
      return items.length === 0 ? EMPTY_VALUE : items.map((item) => formatValueText(item, locale)).join(', ')
    }
    default: {
      const entries = Object.entries((value as ObjectValue).entries)
      if (entries.length === 0) return EMPTY_VALUE
      return entries.map(([key, entry]) => `${key}: ${formatValueText(entry, locale)}`).join(', ')
    }
  }
}

export type TextSegment = { text: string } | { link: ParsedWikilink; raw: string }

/** Splits task text into plain text and `[[wikilinks]]`, so links can be rendered clickable; embeds stay text. */
export const splitWikilinks = (text: string): TextSegment[] => {
  const segments: TextSegment[] = []
  let plain = ''
  let i = 0
  while (i < text.length) {
    const match = text.startsWith('[[', i) || text.startsWith('![[', i) ? matchWikilink(text.slice(i)) : null
    if (!match) {
      plain += text[i]
      i++
      continue
    }
    i += match.raw.length
    if (match.link.embed) {
      plain += match.raw
      continue
    }
    if (plain) segments.push({ text: plain })
    plain = ''
    segments.push({ link: match.link, raw: match.raw })
  }
  if (plain) segments.push({ text: plain })
  return segments
}

/** Label shown for a wikilink inside task text: its alias, else the target and heading. */
export const wikilinkLabel = (link: ParsedWikilink): string =>
  link.alias ?? [link.target, link.heading].filter(Boolean).join(' > ')

/** Localized "Line 2, column 7: message" for a query error. */
export const formatQueryError = (
  error: QueryErrorInfo,
  t: (key: string, params?: Record<string, string | number>) => string
): string => `${t('errors.location', { line: error.line, column: error.column })}: ${t(`errors.${error.code}`, error.params)}`

// ---------------------------------------------------------------------------
// Static HTML (export)
// ---------------------------------------------------------------------------

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const valueToHtml = (value: Value, locale: string): string => {
  if (Array.isArray(value) && value.length > 0) return value.map((item) => valueToHtml(item, locale)).join(', ')
  if (typeOf(value) === 'link') return `<span class="dataview-link">${escapeHtml(linkText(value as LinkValue))}</span>`
  return escapeHtml(formatValueText(value, locale))
}

const taskTextToHtml = (text: string): string =>
  splitWikilinks(text)
    .map((segment) =>
      'link' in segment
        ? `<span class="dataview-link">${escapeHtml(wikilinkLabel(segment.link))}</span>`
        : escapeHtml(segment.text)
    )
    .join('')

export interface HtmlLabels {
  locale: string
  /** Header of the file column. */
  file: string
  empty: string
  /** Notice shown when results were capped, or null. */
  truncated: string | null
}

/** Static, escaped HTML of a query result for HTML/PDF export. */
export const resultToHtml = (result: QueryResult, labels: HtmlLabels): string => {
  const { locale } = labels
  const notice = labels.truncated ? `<p class="dataview-note">${escapeHtml(labels.truncated)}</p>` : ''
  const isEmpty =
    result.type === 'table' ? result.rows.length === 0 : result.type === 'list' ? result.items.length === 0 : result.groups.length === 0
  if (isEmpty) return `<p class="dataview-empty">${escapeHtml(labels.empty)}</p>`

  if (result.type === 'table') {
    const headers = [...(result.idColumn ? [labels.file] : []), ...result.headers]
    const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>`
    const body = result.rows
      .map((row) => {
        const cells = [...(result.idColumn ? [valueToHtml(row.link, locale)] : []), ...row.cells.map((cell) => valueToHtml(cell, locale))]
        return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`
      })
      .join('')
    return `<table class="dataview dataview-table">${head}<tbody>${body}</tbody></table>${notice}`
  }

  if (result.type === 'list') {
    const items = result.items
      .map((item) => {
        const parts = [
          ...(result.idColumn || !result.hasValue ? [valueToHtml(item.link, locale)] : []),
          ...(result.hasValue ? [valueToHtml(item.value, locale)] : [])
        ]
        return `<li>${parts.join(': ')}</li>`
      })
      .join('')
    return `<ul class="dataview dataview-list">${items}</ul>${notice}`
  }

  const groups = result.groups
    .map((group) => {
      const tasks = group.tasks
        .map(
          (task) =>
            `<li class="task-list-item"><input type="checkbox" disabled${task.checked ? ' checked' : ''}> ${taskTextToHtml(task.text)}</li>`
        )
        .join('')
      return `<div class="dataview-task-group"><p class="dataview-task-file">${valueToHtml(group.link, locale)}</p><ul class="contains-task-list">${tasks}</ul></div>`
    })
    .join('')
  return `<div class="dataview dataview-tasks">${groups}</div>${notice}`
}
