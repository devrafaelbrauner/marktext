import { describe, expect, it } from 'vitest'
import { dayjs, keyToDate } from '@plugins/daily-notes/common/dates'
import { renderTemplate, type TemplateContext } from '@plugins/daily-notes/common/template'

// The note is for Sunday 2026-10-04 but is created the next afternoon.
const context = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  date: keyToDate('2026-10-04'),
  now: dayjs(new Date(2026, 9, 5, 14, 7, 9)),
  format: 'YYYY-MM-DD',
  title: '2026-10-04',
  locale: 'en',
  ...overrides
})

describe('daily-notes template rendering', () => {
  it('fills every variable', () => {
    const template = [
      '# {{title}}',
      'date: {{date}}',
      'custom: {{date:dddd, MMMM Do}}',
      'time: {{time}}',
      'seconds: {{time:HH:mm:ss}}',
      'prev: [[{{yesterday}}]] next: [[{{tomorrow}}]]'
    ].join('\n')
    expect(renderTemplate(template, context())).toBe(
      [
        '# 2026-10-04',
        'date: 2026-10-04',
        'custom: Sunday, October 4th',
        'time: 14:07',
        'seconds: 14:07:09',
        'prev: [[2026-10-03]] next: [[2026-10-05]]'
      ].join('\n')
    )
  })

  it('uses the format setting for date, yesterday and tomorrow', () => {
    expect(renderTemplate('{{date}} {{yesterday}} {{tomorrow}}', context({ format: 'DD/MM/YYYY' }))).toBe(
      '04/10/2026 03/10/2026 05/10/2026'
    )
  })

  it('crosses month and year boundaries for yesterday/tomorrow', () => {
    expect(renderTemplate('{{yesterday}}', context({ date: keyToDate('2026-01-01') }))).toBe('2025-12-31')
    expect(renderTemplate('{{tomorrow}}', context({ date: keyToDate('2024-02-28') }))).toBe('2024-02-29')
  })

  it('localizes names with the note locale', () => {
    expect(renderTemplate('{{date:dddd, D [de] MMMM}}', context({ locale: 'pt-br' }))).toBe('domingo, 4 de outubro')
  })

  it('accepts spaces inside the braces and any letter case', () => {
    expect(renderTemplate('{{ date }} {{ TITLE }} {{Time}}', context())).toBe('2026-10-04 2026-10-04 14:07')
  })

  it('applies Obsidian date offsets', () => {
    expect(renderTemplate('{{date+1d:YYYY-MM-DD}}', context())).toBe('2026-10-05')
    expect(renderTemplate('{{date-1M:YYYY-MM}}', context())).toBe('2026-09')
    expect(renderTemplate('{{date+1w}}', context())).toBe('2026-10-11')
    expect(renderTemplate('{{date+1q:YYYY-MM}}', context())).toBe('2027-01')
    expect(renderTemplate('{{time+30m}}', context())).toBe('14:37')
  })

  it('leaves unknown or malformed placeholders untouched', () => {
    const template = '{{weather}} {{title:upper}} {{yesterday+1d}} {{date:}} {date} {{ value }}'
    expect(renderTemplate(template, context())).toBe(template)
  })

  it('handles adjacent placeholders and an empty template', () => {
    expect(renderTemplate('{{date:YYYY}}{{date:MM}}', context())).toBe('202610')
    expect(renderTemplate('', context())).toBe('')
  })

  it('renders the fixture template', () => {
    expect(renderTemplate('# {{date}}\n\nmood::\n\n- [ ] First task\n', context())).toBe(
      '# 2026-10-04\n\nmood::\n\n- [ ] First task\n'
    )
  })
})
