import { describe, expect, it } from 'vitest'
import type { FileMetadata } from '@shared/plugins/types'
import { runQuery, type ListResult, type TableResult } from '@plugins/dataview/common/engine'
import { QueryError } from '@plugins/dataview/common/errors'
import { Evaluator } from '@plugins/dataview/common/evaluator'
import { parseExpression } from '@plugins/dataview/common/parser'
import type { QueryIndex } from '@plugins/dataview/common/pages'
import {
  makeObject,
  parseDateText,
  parseDurationText,
  valueToString,
  type LinkValue,
  type Value
} from '@plugins/dataview/common/values'

const NOW = new Date(2026, 9, 4, 15, 30, 0).getTime()

const evaluator = (maxSteps = 10_000): Evaluator =>
  new Evaluator({
    resolveLink: (target, display) => ({ type: 'link', path: `/vault/${target}.md`, display, subpath: null, embed: false, resolved: true }),
    pageOf: () => null,
    now: NOW,
    maxSteps
  })

const row = makeObject([
  ['title', 'Hello World'],
  ['count', 3],
  ['missing', null],
  ['tags', ['#a', '#b/c']],
  ['due', parseDateText('2026-10-10')],
  ['Due Date', 'spaced'],
  ['meta', makeObject([['key', 1]])]
])

const evaluate = (source: string): Value => evaluator().evaluate(parseExpression(source), { row, thisPage: null })
const text = (source: string): string => valueToString(evaluate(source))

const failure = (source: string): QueryError => {
  try {
    evaluate(source)
  } catch (error) {
    if (error instanceof QueryError) return error
    throw error
  }
  throw new Error(`expected ${source} to fail`)
}

describe('Dataview expression semantics', () => {
  it('reads fields case-insensitively and with spaces as dashes; missing fields are null', () => {
    expect(evaluate('TITLE')).toBe('Hello World')
    expect(evaluate('due-date')).toBe('spaced')
    expect(evaluate('nothing')).toBeNull()
    expect(evaluate('meta.key')).toBe(1)
    expect(evaluate('meta.nothing.deeper')).toBeNull()
    expect(evaluate('row["Due Date"]')).toBe('spaced')
    expect(evaluate('tags[1]')).toBe('#b/c')
    expect(evaluate('tags[5]')).toBeNull()
  })

  it('is null-safe in arithmetic and orders null before everything', () => {
    expect(evaluate('missing + 1')).toBeNull()
    expect(evaluate('missing * count')).toBeNull()
    expect(evaluate('missing < 0')).toBe(true)
    expect(evaluate('missing = null')).toBe(true)
    expect(evaluate('missing != 0')).toBe(true)
    expect(evaluate('-missing')).toBeNull()
    expect(evaluate('!missing')).toBe(true)
  })

  it('applies Dataview truthiness to AND, OR and NOT', () => {
    expect(evaluate('"" or 0 or []')).toBe(false)
    expect(evaluate('count and title')).toBe(true)
    expect(evaluate('!tags')).toBe(false)
    expect(evaluate('!list()')).toBe(true)
  })

  it('computes numbers, strings and lists', () => {
    expect(evaluate('count * 2 + 1')).toBe(7)
    expect(evaluate('7 % 4')).toBe(3)
    expect(evaluate('1 / 0')).toBeNull()
    expect(evaluate('"n=" + count')).toBe('n=3')
    expect(evaluate('"ab" * 3')).toBe('ababab')
    expect(evaluate('list(1, 2) + list(3)')).toEqual([1, 2, 3])
    expect(failure('title - 1')).toMatchObject({ code: 'invalidOperation', params: { op: '-', left: 'string', right: 'number' }, offset: 6 })
    expect(failure('-title')).toMatchObject({ code: 'invalidUnary', params: { op: '-', operand: 'string' } })
  })

  it('compares strings, numbers, dates and mixed types consistently', () => {
    expect(evaluate('"apple" < "banana"')).toBe(true)
    expect(evaluate('10 > 9')).toBe(true)
    expect(evaluate('due > date(2026-10-04)')).toBe(true)
    expect(evaluate('due = date(2026-10-10)')).toBe(true)
    // Different types order by type name: "number" < "string".
    expect(evaluate('1 < "1"')).toBe(true)
    expect(evaluate('[1, 2] < [1, 3]')).toBe(true)
  })

  it('does date and duration arithmetic with calendar months and days', () => {
    expect(text('date(today)')).toBe('2026-10-04')
    expect(text('date(tomorrow)')).toBe('2026-10-05')
    expect(text('date(sow)')).toBe('2026-09-28')
    expect(text('date(som)')).toBe('2026-10-01')
    expect(text('date(eom)')).toBe('2026-10-31T23:59:59')
    expect(text('date(now)')).toBe('2026-10-04T15:30:00')
    expect(text('date(2026-01-31) + dur(1 month)')).toBe('2026-02-28')
    expect(text('date(2026-03-31) - dur(1 month)')).toBe('2026-02-28')
    expect(text('date(2026-10-04) + dur(1 week)')).toBe('2026-10-11')
    expect(text('date(2026-10-04) + dur(1 year, 2 days)')).toBe('2027-10-06')
    expect(text('date(2026-10-04T10:00) + dur(90 minutes)')).toBe('2026-10-04T11:30:00')
    expect(text('due - date(today)')).toBe('6 days')
    expect(text('dur(2 hours) * 3')).toBe('6 hours')
    expect(text('dur(1 day) + dur(12 hours)')).toBe('1 day, 12 hours')
    expect(evaluate('dur(1 week) > dur(6 days)')).toBe(true)
    expect(evaluate('dur(1 month) < dur(31 days)')).toBe(true)
    expect(evaluate('due.year * 100 + due.month')).toBe(202610)
    expect(evaluate('due.weekday')).toBe(6)
    expect(evaluate('(due - date(today)).days')).toBe(6)
  })

  it('implements contains on strings, lists and objects', () => {
    expect(evaluate('contains(title, "World")')).toBe(true)
    expect(evaluate('contains(title, "world")')).toBe(false)
    expect(evaluate('contains(tags, "#b")')).toBe(true)
    expect(evaluate('contains(list(1, 2), 2)')).toBe(true)
    expect(evaluate('contains(list(1, 2), 3)')).toBe(false)
    expect(evaluate('contains(meta, "key")')).toBe(true)
    expect(evaluate('contains(missing, "x")')).toBe(false)
    expect(evaluate('contains(list([[A]], [[B]]), [[B]])')).toBe(true)
  })

  it('implements the remaining functions', () => {
    expect(evaluate('length(tags)')).toBe(2)
    expect(evaluate('length(title)')).toBe(11)
    expect(evaluate('length(missing)')).toBe(0)
    expect(evaluate('lower(title)')).toBe('hello world')
    expect(evaluate('upper(tags)')).toEqual(['#A', '#B/C'])
    expect(evaluate('default(missing, "-")')).toBe('-')
    expect(evaluate('default(list(1, null), 0)')).toEqual([1, 0])
    expect(evaluate('choice(count > 2, "big", "small")')).toBe('big')
    expect(evaluate('round(2.567, 2)')).toBe(2.57)
    expect(evaluate('round(list(1.4, 1.6))')).toEqual([1, 2])
    expect(evaluate('min(3, 1, 2)')).toBe(1)
    expect(evaluate('max(list(3, null, 7))')).toBe(7)
    expect(evaluate('sum(list(1, 2, null, 4))')).toBe(7)
    expect(text('sum(list(dur(1 day), dur(2 days)))')).toBe('3 days')
    expect(evaluate('sum(list())')).toBeNull()
    expect(evaluate('typeof(due)')).toBe('date')
    expect(evaluate('typeof(tags)')).toBe('array')
    expect(evaluate('typeof(meta)')).toBe('object')
    expect(evaluate('typeof([[A]])')).toBe('link')
    expect(evaluate('startswith(title, "Hello")')).toBe(true)
    expect(evaluate('endswith(title, "Hello")')).toBe(false)
    expect(evaluate('startswith(missing, "x")')).toBe(false)
    expect(text('date("2026-10-04")')).toBe('2026-10-04')
    expect(evaluate('date("not a date")')).toBeNull()
    expect(text('dur("3 days")')).toBe('3 days')
    expect(evaluate('link("Home", "Start")')).toMatchObject({ type: 'link', path: '/vault/Home.md', display: 'Start' })
    expect(evaluate('number("about 42.5 km")')).toBe(42.5)
    expect(evaluate('number("none")')).toBeNull()
    expect(evaluate('string(count)')).toBe('3')
    expect(evaluate('join(tags, " | ")')).toBe('#a | #b/c')
    expect(evaluate('list()')).toEqual([])
    expect(failure('lower(count)')).toMatchObject({ code: 'invalidArgument', params: { name: 'lower', type: 'number' } })
  })

  it('stops after the step budget', () => {
    const tight = evaluator(5)
    expect(() => tight.evaluate(parseExpression('1 + 2 + 3 + 4'), { row, thisPage: null })).toThrow(QueryError)
  })
})

describe('Dataview value parsing', () => {
  it('parses ISO dates, rejecting impossible ones', () => {
    expect(parseDateText('2026-02-29')).toBeNull()
    expect(parseDateText('2028-02-29')).toMatchObject({ dateOnly: true })
    expect(parseDateText('2026-10')).toMatchObject({ dateOnly: true })
    expect(parseDateText('2026-10-04T10:00Z')).toEqual({ type: 'date', ms: Date.UTC(2026, 9, 4, 10), dateOnly: false })
    expect(parseDateText('2026-10-04T10:00+02:00')).toEqual({ type: 'date', ms: Date.UTC(2026, 9, 4, 8), dateOnly: false })
    expect(parseDateText('04/10/2026')).toBeNull()
  })

  it('parses durations in Dataview units', () => {
    expect(parseDurationText('1 year, 2 months and 3 weeks')).toEqual({ type: 'duration', months: 14, days: 21, ms: 0 })
    expect(parseDurationText('1h 30m')).toEqual({ type: 'duration', months: 0, days: 0, ms: 5_400_000 })
    expect(parseDurationText('1.5 days')).toEqual({ type: 'duration', months: 0, days: 1, ms: 43_200_000 })
    expect(parseDurationText('1.5 months')).toBeNull()
    expect(parseDurationText('3 apples')).toBeNull()
    expect(parseDurationText('')).toBeNull()
  })
})

const note = (path: string, extra: Partial<FileMetadata> = {}): FileMetadata => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path: `/vault/${path}`,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: '/vault',
    size: 10,
    ctimeMs: NOW,
    mtimeMs: NOW,
    frontmatter: null,
    aliases: [],
    tags: [],
    headings: [],
    links: [],
    tasks: [],
    fields: {},
    day: null,
    wordCount: 0,
    ...extra
  }
}

const memoryIndex = (files: FileMetadata[]): QueryIndex => ({
  rootPath: '/vault',
  getFile: (path) => files.find((file) => file.path === path) ?? null,
  listFiles: () => [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
  resolveLink: (target) => files.find((file) => file.basename === target)?.path ?? null,
  getBacklinks: () => []
})

describe('Dataview query execution', () => {
  const index = memoryIndex([
    note('a.md', { fields: { rank: 2, group: 'x' } }),
    note('b.md', { fields: { rank: 1, group: 'y' } }),
    note('c.md', { fields: { rank: 2, group: 'z' } }),
    note('d.md', { fields: { group: 'w' } }),
    note('e.md', { frontmatter: { Rank: 1, Group: 'v', due: '2026-10-05', ref: '[[a]]' } })
  ])
  const names = (query: string): string[] => {
    const response = runQuery(query, null, index, { now: NOW })
    if (!response.ok) throw new Error(JSON.stringify(response.error))
    return (response.result as ListResult).items.map((item) => (item.link as LinkValue).path.replace('/vault/', ''))
  }

  it('sorts stably, with nulls first ascending and last descending', () => {
    expect(names('LIST SORT rank')).toEqual(['d.md', 'b.md', 'e.md', 'a.md', 'c.md'])
    expect(names('LIST SORT rank DESC')).toEqual(['a.md', 'c.md', 'b.md', 'e.md', 'd.md'])
    expect(names('LIST SORT rank DESC, group ASC')).toEqual(['a.md', 'c.md', 'e.md', 'b.md', 'd.md'])
  })

  it('applies LIMIT after the commands written before it', () => {
    expect(names('LIST SORT rank DESC LIMIT 2')).toEqual(['a.md', 'c.md'])
    expect(names('LIST LIMIT 2 SORT rank DESC')).toEqual(['a.md', 'b.md'])
    expect(names('LIST LIMIT 0')).toEqual([])
  })

  it('types front matter strings that look like dates and links', () => {
    const response = runQuery('TABLE WITHOUT ID typeof(due), typeof(ref), ref.group FROM "e"', null, index, { now: NOW })
    if (!response.ok) throw new Error(JSON.stringify(response.error))
    expect((response.result as TableResult).rows[0].cells).toEqual(['date', 'link', 'x'])
  })

  it('returns a positioned error for long queries instead of throwing', () => {
    const response = runQuery(`LIST WHERE ${'a or '.repeat(5000)}a`, null, index)
    expect(response).toMatchObject({ ok: false, error: { code: 'queryTooLong', line: 1, column: 1 } })
  })
})
