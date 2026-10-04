import type { Expr, Query } from './ast'
import { QueryError, toErrorInfo, type QueryErrorInfo } from './errors'
import { Evaluator, type EvaluationScope } from './evaluator'
import { PageStore, type QueryIndex } from './pages'
import { parseQuery } from './parser'
import { selectSources } from './sources'
import { compareValues, getField, isTruthy, makeObject, typeOf, type LinkValue, type ObjectValue, type Value } from './values'

export interface TableResult {
  type: 'table'
  /** False for `TABLE WITHOUT ID`. */
  idColumn: boolean
  /** Headers of the value columns (the file column header is added by the view). */
  headers: string[]
  rows: Array<{ link: LinkValue; cells: Value[] }>
  /** Rows before the result cap. */
  total: number
}

export interface ListResult {
  type: 'list'
  idColumn: boolean
  /** True for `LIST expr`. */
  hasValue: boolean
  items: Array<{ link: LinkValue; value: Value }>
  total: number
}

export interface TaskItem {
  /** 0-based line of the task in its note. */
  line: number
  /** Character between the brackets. */
  status: string
  text: string
  checked: boolean
}

export interface TaskResult {
  type: 'task'
  /** Tasks grouped by note, in result order. */
  groups: Array<{ link: LinkValue; tasks: TaskItem[] }>
  total: number
}

export type QueryResult = TableResult | ListResult | TaskResult

export type QueryResponse = { ok: true; result: QueryResult } | { ok: false; error: QueryErrorInfo }

export interface RunOptions {
  /** Clock for `date(today)` and friends; default `Date.now()`. */
  now?: number
  /** Rows (or tasks) returned at most; `total` still counts all. */
  maxResults?: number
  /** Expression evaluation steps one run may take. */
  maxSteps?: number
}

const DEFAULT_MAX_RESULTS = 1000
const DEFAULT_MAX_STEPS = 2_000_000
const MAX_QUERY_LENGTH = 20_000

/** Longest list and deepest nesting a result value keeps. */
const MAX_VALUE_ITEMS = 500
const MAX_VALUE_DEPTH = 6

interface Row {
  /** Absolute path of the note the row comes from. */
  path: string
  data: ObjectValue
  task: TaskItem | null
}

/** Bounds a value for transfer: long lists are cut and deep nesting becomes null. */
const boundValue = (value: Value, depth = 0): Value => {
  if (depth > MAX_VALUE_DEPTH) return null
  if (Array.isArray(value)) return value.slice(0, MAX_VALUE_ITEMS).map((item) => boundValue(item, depth + 1))
  if (typeOf(value) === 'object') {
    return makeObject(
      Object.entries((value as ObjectValue).entries).map(([key, entry]): [string, Value] => [key, boundValue(entry, depth + 1)])
    )
  }
  return value
}

/**
 * Evaluates `fn` for every row the way Dataview tolerates bad data: a row
 * whose evaluation fails is skipped (`fallback` undefined) or gets
 * `fallback`; only when every row fails does the first error fail the query.
 * Running out of evaluation budget always fails.
 */
const evaluateRows = <T>(rows: Row[], fn: (row: Row) => T, fallback?: T): Array<{ row: Row; value: T }> => {
  const results: Array<{ row: Row; value: T }> = []
  let firstError: QueryError | null = null
  let failures = 0
  for (const row of rows) {
    try {
      results.push({ row, value: fn(row) })
    } catch (error) {
      if (!(error instanceof QueryError) || error.code === 'budgetExceeded') throw error
      firstError ??= error
      failures++
      if (fallback !== undefined) results.push({ row, value: fallback })
    }
  }
  if (firstError && failures === rows.length) throw firstError
  return results
}

const execute = (query: Query, originPath: string | null, index: QueryIndex, options: RunOptions): QueryResult => {
  const pages = new PageStore(index)
  const evaluator = new Evaluator({
    resolveLink: (target, display, subpath, embed) => pages.link(target, originPath, display, subpath ?? null, embed ?? false),
    pageOf: (link) => (link.resolved ? pages.page(link.path) : null),
    now: options.now ?? Date.now(),
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS
  })
  const thisPage = originPath ? pages.page(originPath) : null
  const evaluate = (expr: Expr, row: Row): Value => {
    const scope: EvaluationScope = { row: row.data, thisPage }
    return evaluator.evaluate(expr, scope)
  }

  const paths = query.source ? selectSources(query.source, pages, originPath) : index.listFiles().map((file) => file.path)
  let rows: Row[] = []
  for (const path of paths) {
    const page = pages.page(path)
    if (!page) continue
    if (query.header.type !== 'task') {
      rows.push({ path, data: page, task: null })
      continue
    }
    const file = getField(page, 'file')
    for (const { entry, task } of pages.tasksOf(path)) {
      rows.push({
        path,
        data: makeObject([...Object.entries(task.entries), ['file', file]]),
        task: { line: entry.line, status: entry.status, text: entry.text, checked: entry.checked }
      })
    }
  }

  for (const command of query.commands) {
    switch (command.kind) {
      case 'where':
        rows = evaluateRows(rows, (row) => isTruthy(evaluate(command.expr, row)))
          .filter((result) => result.value)
          .map((result) => result.row)
        break
      case 'sort': {
        const keyed = evaluateRows(
          rows,
          (row) => command.keys.map((key) => evaluate(key.expr, row)),
          command.keys.map((): Value => null)
        )
        // Array.prototype.sort is stable: rows with equal keys keep their order.
        keyed.sort((a, b) => {
          for (let i = 0; i < command.keys.length; i++) {
            const order = compareValues(a.value[i], b.value[i])
            if (order !== 0) return command.keys[i].direction === 'desc' ? -order : order
          }
          return 0
        })
        rows = keyed.map((result) => result.row)
        break
      }
      case 'limit':
        rows = rows.slice(0, command.count)
        break
    }
  }

  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS
  const total = rows.length
  const shown = rows.slice(0, maxResults)
  const { header } = query

  if (header.type === 'table') {
    const columns = header.fields.map((field) =>
      evaluateRows(shown, (row) => boundValue(evaluate(field.expr, row)), null).map((result) => result.value)
    )
    return {
      type: 'table',
      idColumn: !header.withoutId,
      headers: header.fields.map((field) => field.name),
      rows: shown.map((row, i) => ({ link: pages.fileLink(row.path), cells: columns.map((column) => column[i]) })),
      total
    }
  }

  if (header.type === 'list') {
    const { expr } = header
    const values = expr
      ? evaluateRows(shown, (row) => boundValue(evaluate(expr, row)), null).map((result) => result.value)
      : shown.map((): Value => null)
    return {
      type: 'list',
      idColumn: !header.withoutId,
      hasValue: expr !== null,
      items: shown.map((row, i) => ({ link: pages.fileLink(row.path), value: values[i] })),
      total
    }
  }

  const groups = new Map<string, TaskItem[]>()
  for (const row of shown) {
    if (!row.task) continue
    const group = groups.get(row.path)
    if (group) group.push(row.task)
    else groups.set(row.path, [row.task])
  }
  return {
    type: 'task',
    groups: [...groups].map(([path, tasks]) => ({ link: pages.fileLink(path), tasks })),
    total
  }
}

/**
 * Parses and runs a query against the index. `originPath` is the note
 * holding the query (`this`, relative links), or null. Errors (syntax and
 * evaluation) come back as data with their position in `text`.
 */
export const runQuery = (
  text: string,
  originPath: string | null,
  index: QueryIndex,
  options: RunOptions = {}
): QueryResponse => {
  if (text.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: toErrorInfo(new QueryError('queryTooLong', 0, { max: MAX_QUERY_LENGTH }), text) }
  }
  try {
    return { ok: true, result: execute(parseQuery(text), originPath, index, options) }
  } catch (error) {
    if (error instanceof QueryError) return { ok: false, error: toErrorInfo(error, text) }
    throw error
  }
}
