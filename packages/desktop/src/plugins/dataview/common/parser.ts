import type { BinaryOperator, DataCommand, Expr, Query, QueryHeader, SortKey, Source, TableField } from './ast'
import { QueryError } from './errors'
import { FUNCTION_ARITY } from './functions'
import { tokenize, type Token } from './lexer'
import { parseDateText, parseDurationText, relativeDate } from './values'

// `group` starts a clause only as `GROUP BY`, so fields named `group` keep working.
const CLAUSE_KEYWORDS: Record<string, true> = {
  from: true,
  where: true,
  sort: true,
  limit: true,
  flatten: true,
  calendar: true
}

const UNSUPPORTED_COMMANDS: Record<string, string> = {
  group: 'GROUP BY',
  flatten: 'FLATTEN',
  calendar: 'CALENDAR'
}

const COMPARISON: Record<string, BinaryOperator> = {
  '=': '=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>='
}

class Parser {
  private readonly tokens: Token[]
  private position = 0

  constructor(private readonly text: string) {
    this.tokens = tokenize(text)
  }

  private get current(): Token {
    return this.tokens[this.position]
  }

  private peek(offset = 1): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]
  }

  private advance(): Token {
    const token = this.current
    if (token.kind !== 'eof') this.position++
    return token
  }

  private isKeyword(word: string, token: Token = this.current): boolean {
    return token.kind === 'identifier' && token.value.toLowerCase() === word
  }

  private isClauseStart(): boolean {
    const token = this.current
    if (token.kind === 'eof') return true
    if (token.kind !== 'identifier') return false
    const word = token.value.toLowerCase()
    return CLAUSE_KEYWORDS[word] === true || (word === 'group' && this.isKeyword('by', this.peek()))
  }

  private isPunct(value: string, token: Token = this.current): boolean {
    return token.kind === 'punct' && token.value === value
  }

  private unexpected(expected: string): QueryError {
    const token = this.current
    if (token.kind === 'eof') return new QueryError('unexpectedEnd', token.start, { expected })
    return new QueryError('unexpectedToken', token.start, { found: this.text.slice(token.start, token.end), expected })
  }

  private expectPunct(value: string): Token {
    if (!this.isPunct(value)) throw this.unexpected(value)
    return this.advance()
  }

  private expectKeyword(word: string): Token {
    if (!this.isKeyword(word)) throw this.unexpected(word.toUpperCase())
    return this.advance()
  }

  parseQuery(): Query {
    const header = this.parseHeader()
    let source: Source | null = null
    const commands: DataCommand[] = []
    while (this.current.kind !== 'eof') {
      const token = this.current
      const word = token.kind === 'identifier' ? token.value.toLowerCase() : ''
      if (word === 'from') {
        if (source !== null || commands.length > 0) throw new QueryError('fromNotFirst', token.start)
        this.advance()
        source = this.parseSource()
      } else if (word === 'where') {
        this.advance()
        const expr = this.parseExpression()
        commands.push({ kind: 'where', expr, start: token.start, end: expr.end })
      } else if (word === 'sort') {
        this.advance()
        const keys = this.parseSortKeys()
        commands.push({ kind: 'sort', keys, start: token.start, end: this.tokens[this.position - 1].end })
      } else if (word === 'limit') {
        this.advance()
        const count = this.current
        if (count.kind !== 'number' || !Number.isInteger(count.value)) throw new QueryError('invalidLimit', count.start)
        this.advance()
        commands.push({ kind: 'limit', count: count.value, start: token.start, end: count.end })
      } else if (Object.hasOwn(UNSUPPORTED_COMMANDS, word)) {
        throw new QueryError('unsupportedCommand', token.start, { command: UNSUPPORTED_COMMANDS[word] })
      } else {
        throw this.unexpected('FROM, WHERE, SORT, LIMIT')
      }
    }
    return { header, source, commands }
  }

  private parseHeader(): QueryHeader {
    const token = this.current
    const word = token.kind === 'identifier' ? token.value.toLowerCase() : ''
    if (word === 'table') {
      this.advance()
      const withoutId = this.parseWithoutId()
      const fields: TableField[] = []
      if (!this.isClauseStart()) {
        do {
          fields.push(this.parseTableField())
        } while (this.isPunct(',') && this.advance())
      }
      return { type: 'table', withoutId, fields }
    }
    if (word === 'list') {
      this.advance()
      const withoutId = this.parseWithoutId()
      const expr = this.isClauseStart() ? null : this.parseExpression()
      return { type: 'list', withoutId, expr }
    }
    if (word === 'task') {
      this.advance()
      if (!this.isClauseStart()) throw this.unexpected('FROM, WHERE, SORT, LIMIT')
      return { type: 'task' }
    }
    if (word === 'calendar') throw new QueryError('unsupportedQueryType', token.start, { type: 'CALENDAR' })
    throw new QueryError('expectedQueryType', token.start)
  }

  private parseWithoutId(): boolean {
    if (!this.isKeyword('without') || !this.isKeyword('id', this.peek())) return false
    this.advance()
    this.advance()
    return true
  }

  private parseTableField(): TableField {
    const expr = this.parseExpression()
    let name = this.text.slice(expr.start, expr.end).trim()
    if (this.isKeyword('as')) {
      this.advance()
      const alias = this.current
      if (alias.kind !== 'string' && alias.kind !== 'identifier') throw this.unexpected('"…"')
      this.advance()
      name = alias.value
    }
    return { expr, name }
  }

  private parseSortKeys(): SortKey[] {
    const keys: SortKey[] = []
    do {
      const expr = this.parseExpression()
      let direction: SortKey['direction'] = 'asc'
      if (this.isKeyword('asc') || this.isKeyword('ascending')) this.advance()
      else if (this.isKeyword('desc') || this.isKeyword('descending')) {
        this.advance()
        direction = 'desc'
      }
      keys.push({ expr, direction })
    } while (this.isPunct(',') && this.advance())
    return keys
  }

  // -- Sources ---------------------------------------------------------------

  private parseSource(): Source {
    let left = this.parseSourceAnd()
    while (this.isKeyword('or')) {
      this.advance()
      const right = this.parseSourceAnd()
      left = { kind: 'or', left, right, start: left.start, end: right.end }
    }
    return left
  }

  private parseSourceAnd(): Source {
    let left = this.parseSourceNot()
    while (this.isKeyword('and')) {
      this.advance()
      const right = this.parseSourceNot()
      left = { kind: 'and', left, right, start: left.start, end: right.end }
    }
    return left
  }

  private parseSourceNot(): Source {
    const token = this.current
    if (this.isPunct('-') || this.isPunct('!') || this.isKeyword('not')) {
      this.advance()
      const source = this.parseSourceNot()
      return { kind: 'not', source, start: token.start, end: source.end }
    }
    return this.parseSourceAtom()
  }

  private parseSourceAtom(): Source {
    const token = this.current
    if (token.kind === 'tag') {
      this.advance()
      return { kind: 'tag', tag: token.value, start: token.start, end: token.end }
    }
    if (token.kind === 'string') {
      this.advance()
      return { kind: 'folder', path: token.value, start: token.start, end: token.end }
    }
    if (token.kind === 'link') {
      this.advance()
      return { kind: 'incoming', target: token.value.target, start: token.start, end: token.end }
    }
    if (this.isKeyword('outgoing') && this.isPunct('(', this.peek())) {
      this.advance()
      this.advance()
      const link = this.current
      if (link.kind !== 'link') throw this.unexpected('[[…]]')
      this.advance()
      const close = this.expectPunct(')')
      return { kind: 'outgoing', target: link.value.target, start: token.start, end: close.end }
    }
    if (this.isPunct('(')) {
      this.advance()
      const source = this.parseSource()
      const close = this.expectPunct(')')
      return { ...source, start: token.start, end: close.end }
    }
    if (token.kind === 'eof') throw new QueryError('unexpectedEnd', token.start, { expected: '#tag, "folder", [[link]]' })
    throw new QueryError('expectedSource', token.start, { found: this.text.slice(token.start, token.end) })
  }

  // -- Expressions -----------------------------------------------------------

  parseExpression(): Expr {
    return this.parseOr()
  }

  private parseBinaryLevel(next: () => Expr, match: () => BinaryOperator | null): Expr {
    let left = next()
    for (let op = match(); op !== null; op = match()) {
      const opStart = this.advance().start
      const right = next()
      left = { kind: 'binary', op, left, right, opStart, start: left.start, end: right.end }
    }
    return left
  }

  private parseOr(): Expr {
    return this.parseBinaryLevel(
      () => this.parseAnd(),
      () => (this.isKeyword('or') || this.isPunct('|') ? 'or' : null)
    )
  }

  private parseAnd(): Expr {
    return this.parseBinaryLevel(
      () => this.parseComparison(),
      () => (this.isKeyword('and') || this.isPunct('&') ? 'and' : null)
    )
  }

  private parseComparison(): Expr {
    return this.parseBinaryLevel(
      () => this.parseAdditive(),
      () => (this.current.kind === 'punct' ? (COMPARISON[this.current.value] ?? null) : null)
    )
  }

  private parseAdditive(): Expr {
    return this.parseBinaryLevel(
      () => this.parseMultiplicative(),
      () => (this.isPunct('+') ? '+' : this.isPunct('-') ? '-' : null)
    )
  }

  private parseMultiplicative(): Expr {
    return this.parseBinaryLevel(
      () => this.parseUnary(),
      () => (this.isPunct('*') ? '*' : this.isPunct('/') ? '/' : this.isPunct('%') ? '%' : null)
    )
  }

  private parseUnary(): Expr {
    const token = this.current
    if (this.isPunct('!') || this.isPunct('-')) {
      this.advance()
      const operand = this.parseUnary()
      return { kind: 'unary', op: token.value as '!' | '-', operand, start: token.start, end: operand.end }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary()
    for (;;) {
      if (this.isPunct('.')) {
        this.advance()
        const name = this.current
        if (name.kind !== 'identifier') throw new QueryError('expectedField', name.start)
        this.advance()
        expr = { kind: 'member', object: expr, name: name.value, start: expr.start, end: name.end }
      } else if (this.isPunct('[')) {
        this.advance()
        const index = this.parseExpression()
        const close = this.expectPunct(']')
        expr = { kind: 'index', object: expr, index, start: expr.start, end: close.end }
      } else {
        return expr
      }
    }
  }

  private parsePrimary(): Expr {
    const token = this.current
    switch (token.kind) {
      case 'number':
      case 'string':
        this.advance()
        return { kind: 'literal', value: token.value, start: token.start, end: token.end }
      case 'link': {
        this.advance()
        const link = token.value
        return {
          kind: 'link',
          target: link.target,
          subpath: link.blockId ? `^${link.blockId}` : (link.heading ?? link.subpath ?? null),
          display: link.alias ?? null,
          embed: link.embed,
          start: token.start,
          end: token.end
        }
      }
      case 'dateLiteral': {
        this.advance()
        if (relativeDate(token.value, 0) !== null) {
          return { kind: 'relativeDate', keyword: token.value.toLowerCase(), start: token.start, end: token.end }
        }
        const date = parseDateText(token.value)
        if (!date) throw new QueryError('invalidDate', token.start, { text: token.value })
        return { kind: 'literal', value: date, start: token.start, end: token.end }
      }
      case 'durationLiteral': {
        this.advance()
        const duration = parseDurationText(token.value)
        if (!duration) throw new QueryError('invalidDuration', token.start, { text: token.value })
        return { kind: 'literal', value: duration, start: token.start, end: token.end }
      }
      case 'identifier':
        return this.parseIdentifier()
      case 'punct':
        if (token.value === '(') {
          this.advance()
          const inner = this.parseExpression()
          const close = this.expectPunct(')')
          return { ...inner, start: token.start, end: close.end }
        }
        if (token.value === '[') {
          this.advance()
          const items = this.parseArguments(']')
          const close = this.expectPunct(']')
          return { kind: 'list', items, start: token.start, end: close.end }
        }
        break
      case 'eof':
        throw new QueryError('missingExpression', token.start)
    }
    throw new QueryError('expectedExpression', token.start, { found: this.text.slice(token.start, token.end) })
  }

  private parseIdentifier(): Expr {
    const token = this.current
    if (token.kind !== 'identifier' || this.isClauseStart()) {
      throw new QueryError('expectedExpression', token.start, { found: this.text.slice(token.start, token.end) })
    }
    this.advance()
    const lower = token.value.toLowerCase()
    if (lower === 'true' || lower === 'false') {
      return { kind: 'literal', value: lower === 'true', start: token.start, end: token.end }
    }
    if (lower === 'null') return { kind: 'literal', value: null, start: token.start, end: token.end }
    if (!this.isPunct('(')) return { kind: 'field', name: token.value, start: token.start, end: token.end }

    if (!Object.hasOwn(FUNCTION_ARITY, lower)) throw new QueryError('unknownFunction', token.start, { name: token.value })
    const arity = FUNCTION_ARITY[lower]
    this.advance()
    const args = this.parseArguments(')')
    const close = this.expectPunct(')')
    const [min, max] = arity
    if (args.length < min || args.length > max) {
      const expected = min === max ? String(min) : max === Infinity ? `${min}+` : `${min}–${max}`
      throw new QueryError('argumentCount', token.start, { name: lower, expected, count: args.length })
    }
    return { kind: 'call', name: lower, args, start: token.start, end: close.end }
  }

  private parseArguments(closer: string): Expr[] {
    const args: Expr[] = []
    if (this.isPunct(closer)) return args
    do {
      args.push(this.parseExpression())
    } while (this.isPunct(',') && this.advance())
    return args
  }

  /** One expression spanning the whole text. */
  parseStandaloneExpression(): Expr {
    const expr = this.parseExpression()
    if (this.current.kind !== 'eof') throw new QueryError('trailingInput', this.current.start, { found: this.text.slice(this.current.start, this.current.end) })
    return expr
  }
}

/** Parses a DQL query; throws `QueryError` pointing at the offending token. */
export const parseQuery = (text: string): Query => new Parser(text).parseQuery()

/** Parses one expression (used by tests and tooling); throws `QueryError`. */
export const parseExpression = (text: string): Expr => new Parser(text).parseStandaloneExpression()
