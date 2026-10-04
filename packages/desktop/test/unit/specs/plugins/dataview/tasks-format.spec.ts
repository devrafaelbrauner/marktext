import { describe, expect, it } from 'vitest'
import { toggleTaskInContent } from '@plugins/dataview/common/tasks'
import { makeDuration, makeObject, parseDateText, type DateValue, type LinkValue } from '@plugins/dataview/common/values'
import type { QueryResult } from '@plugins/dataview/common/engine'
import {
  formatDate,
  formatDuration,
  formatQueryError,
  formatValueText,
  resultToHtml,
  splitWikilinks,
  toIntlLocale
} from '@plugins/dataview/renderer/format'

const DOC = ['# Tasks', '', '- [ ] First [due:: 2026-10-05]', '  - [x] Nested done', '> 1. [/] Quoted ordered', '- [ ] Twin', '- [ ] Twin'].join('\n')

describe('Dataview task toggling', () => {
  it('checks and unchecks the task on the reported line', () => {
    expect(toggleTaskInContent(DOC, 2, 'First [due:: 2026-10-05]', true)?.split('\n')[2]).toBe('- [x] First [due:: 2026-10-05]')
    expect(toggleTaskInContent(DOC, 3, 'Nested done', false)?.split('\n')[3]).toBe('  - [ ] Nested done')
    expect(toggleTaskInContent(DOC, 4, 'Quoted ordered', false)?.split('\n')[4]).toBe('> 1. [ ] Quoted ordered')
  })

  it('changes nothing but the status character', () => {
    const next = toggleTaskInContent(DOC, 2, 'First [due:: 2026-10-05]', true)
    expect(next?.length).toBe(DOC.length)
    expect(next?.split('\n').filter((line, i) => line !== DOC.split('\n')[i])).toHaveLength(1)
  })

  it('finds a moved task by its text when the line no longer matches', () => {
    const shifted = `Intro\n\n${DOC}`
    expect(toggleTaskInContent(shifted, 2, 'First [due:: 2026-10-05]', true)?.split('\n')[4]).toBe('- [x] First [due:: 2026-10-05]')
  })

  it('refuses ambiguous or vanished tasks', () => {
    expect(toggleTaskInContent(`x\n${DOC}`, 5, 'Twin', true)).toBeNull()
    expect(toggleTaskInContent(DOC, 2, 'Renamed task', true)).toBeNull()
    expect(toggleTaskInContent(DOC, 99, 'Gone', true)).toBeNull()
  })

  it('keeps CRLF line endings', () => {
    const crlf = DOC.replace(/\n/g, '\r\n')
    const next = toggleTaskInContent(crlf, 5, 'Twin', true)
    expect(next).toBe(crlf.replace('- [ ] Twin\r\n', '- [x] Twin\r\n'))
  })
})

describe('Dataview value formatting', () => {
  const date = parseDateText('2026-10-04') as DateValue

  it('maps app languages to Intl locales', () => {
    expect(toIntlLocale('pt')).toBe('pt-BR')
    expect(toIntlLocale('zh-CN')).toBe('zh-CN')
  })

  it('formats dates and durations in the UI language', () => {
    expect(formatDate(date, 'en')).toBe('October 4, 2026')
    expect(formatDate(date, 'pt-BR')).toBe('4 de outubro de 2026')
    expect(formatDuration(makeDuration(0, 3, 7_200_000), 'en')).toBe('3 days, 2 hours')
    expect(formatDuration(makeDuration(14, 1, 0), 'pt-BR')).toBe('1 ano, 2 meses, 1 dia')
    expect(formatDuration(makeDuration(0, 0, 0), 'en')).toBe('0 seconds')
  })

  it('formats scalars, lists, links and objects as text', () => {
    const link: LinkValue = { type: 'link', path: '/v/Projects/Alpha.md', display: null, subpath: null, embed: false, resolved: true }
    expect(formatValueText(null, 'en')).toBe('-')
    expect(formatValueText('', 'en')).toBe('-')
    expect(formatValueText(1.5, 'pt-BR')).toBe('1,5')
    expect(formatValueText(1200, 'en')).toBe('1200')
    expect(formatValueText(true, 'en')).toBe('true')
    expect(formatValueText(link, 'en')).toBe('Alpha')
    expect(formatValueText({ ...link, display: 'Project A' }, 'en')).toBe('Project A')
    expect(formatValueText({ ...link, subpath: 'Goals' }, 'en')).toBe('Alpha > Goals')
    expect(formatValueText({ ...link, path: 'Missing Note', resolved: false }, 'en')).toBe('Missing Note')
    expect(formatValueText(['a', 2, null], 'en')).toBe('a, 2, -')
    expect(formatValueText([], 'en')).toBe('-')
    expect(formatValueText(makeObject([['k', 1], ['d', date]]), 'en')).toBe('k: 1, d: October 4, 2026')
  })

  it('splits task text into text and wikilinks', () => {
    expect(splitWikilinks('Review [[Beta|the beta]] and [[Alpha#Goals]] ![[img.png]]')).toEqual([
      { text: 'Review ' },
      { link: { target: 'Beta', alias: 'the beta', embed: false }, raw: '[[Beta|the beta]]' },
      { text: ' and ' },
      { link: { target: 'Alpha', heading: 'Goals', embed: false }, raw: '[[Alpha#Goals]]' },
      { text: ' ![[img.png]]' }
    ])
  })

  it('composes localized error messages with their position', () => {
    const t = (key: string, params?: Record<string, string | number>): string => `${key}${params ? JSON.stringify(params) : ''}`
    expect(formatQueryError({ code: 'invalidLimit', params: {}, offset: 5, line: 2, column: 3 }, t)).toBe(
      'errors.location{"line":2,"column":3}: errors.invalidLimit{}'
    )
  })
})

describe('Dataview HTML export', () => {
  const link = (path: string): LinkValue => ({ type: 'link', path, display: null, subpath: null, embed: false, resolved: true })
  const labels = { locale: 'en', file: 'File', empty: 'No results.', truncated: null }

  it('renders an escaped table with the file column', () => {
    const result: QueryResult = {
      type: 'table',
      idColumn: true,
      headers: ['<b>status</b>'],
      rows: [{ link: link('/v/A & B.md'), cells: ['<script>alert(1)</script>'] }],
      total: 1
    }
    expect(resultToHtml(result, labels)).toBe(
      '<table class="dataview dataview-table"><thead><tr><th>File</th><th>&lt;b&gt;status&lt;/b&gt;</th></tr></thead>' +
        '<tbody><tr><td><span class="dataview-link">A &amp; B</span></td><td>&lt;script&gt;alert(1)&lt;/script&gt;</td></tr></tbody></table>'
    )
  })

  it('renders lists, tasks, empty results and the truncation notice', () => {
    expect(
      resultToHtml(
        { type: 'list', idColumn: true, hasValue: true, items: [{ link: link('/v/N.md'), value: [1, 2] }], total: 3 },
        { ...labels, truncated: 'Showing 1 of 3' }
      )
    ).toBe('<ul class="dataview dataview-list"><li><span class="dataview-link">N</span>: 1, 2</li></ul><p class="dataview-note">Showing 1 of 3</p>')
    expect(
      resultToHtml(
        {
          type: 'task',
          groups: [{ link: link('/v/T.md'), tasks: [{ line: 1, status: 'x', text: 'Done [[T|it]] <now>', checked: true }] }],
          total: 1
        },
        labels
      )
    ).toBe(
      '<div class="dataview dataview-tasks"><div class="dataview-task-group"><p class="dataview-task-file"><span class="dataview-link">T</span></p>' +
        '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled checked> Done <span class="dataview-link">it</span> &lt;now&gt;</li></ul></div></div>'
    )
    expect(resultToHtml({ type: 'list', idColumn: true, hasValue: false, items: [], total: 0 }, labels)).toBe(
      '<p class="dataview-empty">No results.</p>'
    )
  })
})
