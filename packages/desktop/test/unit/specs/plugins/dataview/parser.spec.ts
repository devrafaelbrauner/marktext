import { describe, expect, it } from 'vitest'
import type { Expr, Source } from '@plugins/dataview/common/ast'
import { QueryError, toErrorInfo, type QueryErrorInfo } from '@plugins/dataview/common/errors'
import { tokenize } from '@plugins/dataview/common/lexer'
import { parseExpression, parseQuery } from '@plugins/dataview/common/parser'

/** Compact s-expression of an expression tree, for precedence assertions. */
const show = (expr: Expr): string => {
  switch (expr.kind) {
    case 'literal':
      return JSON.stringify(expr.value)
    case 'link':
      return `[[${expr.target}]]`
    case 'relativeDate':
      return `date(${expr.keyword})`
    case 'field':
      return expr.name
    case 'member':
      return `${show(expr.object)}.${expr.name}`
    case 'index':
      return `${show(expr.object)}[${show(expr.index)}]`
    case 'call':
      return `${expr.name}(${expr.args.map(show).join(', ')})`
    case 'unary':
      return `(${expr.op}${show(expr.operand)})`
    case 'binary':
      return `(${show(expr.left)} ${expr.op} ${show(expr.right)})`
    case 'list':
      return `[${expr.items.map(show).join(', ')}]`
  }
}

const showSource = (source: Source | null): string => {
  if (!source) return ''
  switch (source.kind) {
    case 'tag':
      return `#${source.tag}`
    case 'folder':
      return `"${source.path}"`
    case 'incoming':
      return `[[${source.target}]]`
    case 'outgoing':
      return `outgoing([[${source.target}]])`
    case 'not':
      return `-${showSource(source.source)}`
    default:
      return `(${showSource(source.left)} ${source.kind} ${showSource(source.right)})`
  }
}

const errorOf = (text: string, parse: (text: string) => unknown = parseQuery): QueryErrorInfo => {
  try {
    parse(text)
  } catch (error) {
    if (error instanceof QueryError) return toErrorInfo(error, text)
    throw error
  }
  throw new Error(`expected "${text}" to fail`)
}

describe('Dataview tokenizer', () => {
  it('reads numbers, strings with escapes, tags, links and punctuation', () => {
    const tokens = tokenize('x >= 1.5 AND "a \\"b\\"" != #tag/sub [[Note#H|Alias]]')
    expect(tokens.map((token) => [token.kind, token.kind === 'link' ? token.value.target : token.value])).toEqual([
      ['identifier', 'x'],
      ['punct', '>='],
      ['number', 1.5],
      ['identifier', 'AND'],
      ['string', 'a "b"'],
      ['punct', '!='],
      ['tag', 'tag/sub'],
      ['link', 'Note'],
      ['eof', '']
    ])
  })

  it('keeps dashes inside identifiers like Dataview', () => {
    expect(tokenize('kanban-plugin - 1').map((token) => token.value)).toEqual(['kanban-plugin', '-', 1, ''])
  })

  it('recognises unquoted date and duration literals only in their literal shapes', () => {
    expect(tokenize('date(today) date( 2026-10-04 ) dur(1 week, 2 days)').map((token) => [token.kind, token.value])).toEqual([
      ['dateLiteral', 'today'],
      ['dateLiteral', '2026-10-04'],
      ['durationLiteral', '1 week, 2 days'],
      ['eof', '']
    ])
    expect(tokenize('date(due)')[0]).toMatchObject({ kind: 'identifier', value: 'date' })
  })
})

describe('Dataview query parser', () => {
  it('parses TABLE fields with AS names and expression headers', () => {
    const query = parseQuery('TABLE status, file.mtime AS "Modified", round(budget / 3, 1) AS Third\nFROM "Projects"')
    expect(query.header).toMatchObject({ type: 'table', withoutId: false })
    if (query.header.type !== 'table') throw new Error('not a table')
    expect(query.header.fields.map((field) => [field.name, show(field.expr)])).toEqual([
      ['status', 'status'],
      ['Modified', 'file.mtime'],
      ['Third', 'round((budget / 3), 1)']
    ])
    expect(showSource(query.source)).toBe('"Projects"')
  })

  it('parses TABLE WITHOUT ID, LIST with and without expression, and TASK', () => {
    expect(parseQuery('table without id file.name').header).toMatchObject({ type: 'table', withoutId: true })
    expect(parseQuery('TABLE').header).toEqual({ type: 'table', withoutId: false, fields: [] })
    expect(parseQuery('LIST').header).toEqual({ type: 'list', withoutId: false, expr: null })
    const list = parseQuery('LIST WITHOUT ID file.link FROM #a')
    expect(list.header.type === 'list' && list.header.withoutId && list.header.expr && show(list.header.expr)).toBe('file.link')
    expect(parseQuery('TASK').header).toEqual({ type: 'task' })
  })

  it('parses data commands in written order', () => {
    const query = parseQuery('LIST WHERE a SORT b DESC, c ASC, d LIMIT 5 WHERE e')
    expect(
      query.commands.map((command) =>
        command.kind === 'sort'
          ? `sort ${command.keys.map((key) => `${show(key.expr)} ${key.direction}`).join(', ')}`
          : command.kind === 'limit'
            ? `limit ${command.count}`
            : `where ${show(command.expr)}`
      )
    ).toEqual(['where a', 'sort b desc, c asc, d asc', 'limit 5', 'where e'])
  })

  it('parses FROM sources with precedence NOT > AND > OR and parentheses', () => {
    expect(showSource(parseQuery('LIST FROM #a OR #b AND -"x"').source)).toBe('(#a or (#b and -"x"))')
    expect(showSource(parseQuery('LIST FROM (#a OR #b) AND NOT [[Home]]').source)).toBe('((#a or #b) and -[[Home]])')
    expect(showSource(parseQuery('LIST FROM outgoing([[Projects/Alpha|A]]) and !#x/y').source)).toBe(
      '(outgoing([[Projects/Alpha]]) and -#x/y)'
    )
  })

  it('applies arithmetic, comparison and boolean precedence', () => {
    expect(show(parseExpression('1 + 2 * 3 - 4 % 2'))).toBe('((1 + (2 * 3)) - (4 % 2))')
    expect(show(parseExpression('a + 1 > b * 2 and c or !d'))).toBe('((((a + 1) > (b * 2)) and c) or (!d))')
    expect(show(parseExpression('a & b | c'))).toBe('((a and b) or c)')
    expect(show(parseExpression('-(a + b) * 2'))).toBe('((-(a + b)) * 2)')
    expect(show(parseExpression('a = b != c'))).toBe('((a = b) != c)')
  })

  it('parses literals, member access, indexing, lists and links', () => {
    expect(show(parseExpression('file.tasks[0].text'))).toBe('file.tasks[0].text')
    expect(show(parseExpression('row["due date"]'))).toBe('row["due date"]')
    expect(show(parseExpression('[1, "a", true, null]'))).toBe('[1, "a", true, null]')
    expect(show(parseExpression('[[Home]].file.name'))).toBe('[[Home]].file.name')
    expect(show(parseExpression('date(TODAY) + dur(1 day)'))).toBe('(date(today) + {"type":"duration","months":0,"days":1,"ms":0})')
    expect(parseExpression('date(2026-10-04)')).toMatchObject({ kind: 'literal', value: { type: 'date', dateOnly: true } })
    expect(show(parseExpression('date(file.day)'))).toBe('date(file.day)')
    expect(show(parseExpression('CONTAINS(Tags, "x")'))).toBe('contains(Tags, "x")')
  })

  it('reports syntax errors with line and column', () => {
    expect(errorOf('LIST\nWHERE (a')).toEqual({ code: 'unexpectedEnd', params: { expected: ')' }, offset: 13, line: 2, column: 9 })
    expect(errorOf('TABLE a b')).toMatchObject({ code: 'unexpectedToken', params: { found: 'b' }, line: 1, column: 9 })
    expect(errorOf('FOO')).toMatchObject({ code: 'expectedQueryType', column: 1 })
    expect(errorOf('LIST WHERE x = "open')).toMatchObject({ code: 'unterminatedString', column: 16 })
    expect(errorOf('LIST FROM [[Home')).toMatchObject({ code: 'unterminatedLink', column: 11 })
    expect(errorOf('LIST WHERE a ~ b')).toMatchObject({ code: 'invalidCharacter', params: { char: '~' }, column: 14 })
    expect(errorOf('LIST WHERE')).toMatchObject({ code: 'missingExpression', column: 11 })
    expect(errorOf('LIST FROM 3')).toMatchObject({ code: 'expectedSource', params: { found: '3' } })
    expect(errorOf('LIST LIMIT 2.5')).toMatchObject({ code: 'invalidLimit', column: 12 })
    expect(errorOf('LIST WHERE a FROM #x')).toMatchObject({ code: 'fromNotFirst', column: 14 })
    expect(errorOf('LIST WHERE a.')).toMatchObject({ code: 'expectedField', column: 14 })
    expect(errorOf('LIST WHERE date(2026-13-01)')).toMatchObject({ code: 'invalidDate', params: { text: '2026-13-01' } })
    expect(errorOf('LIST WHERE dur(3 fortnights)')).toMatchObject({ code: 'invalidDuration' })
    expect(errorOf('LIST WHERE frobnicate(x)')).toMatchObject({ code: 'unknownFunction', params: { name: 'frobnicate' } })
    expect(errorOf('LIST WHERE constructor(x)')).toMatchObject({ code: 'unknownFunction' })
    expect(errorOf('LIST WHERE contains(a)')).toMatchObject({ code: 'argumentCount', params: { name: 'contains', expected: '2', count: 1 } })
    expect(errorOf('a b', parseExpression)).toMatchObject({ code: 'trailingInput', params: { found: 'b' } })
  })

  it('reports GROUP BY, FLATTEN and CALENDAR as unsupported', () => {
    expect(errorOf('TABLE x FROM "a"\nGROUP BY status')).toMatchObject({
      code: 'unsupportedCommand',
      params: { command: 'GROUP BY' },
      line: 2,
      column: 1
    })
    expect(errorOf('LIST FLATTEN tags')).toMatchObject({ code: 'unsupportedCommand', params: { command: 'FLATTEN' } })
    expect(errorOf('CALENDAR file.day')).toMatchObject({ code: 'unsupportedQueryType', params: { type: 'CALENDAR' } })
  })
})
