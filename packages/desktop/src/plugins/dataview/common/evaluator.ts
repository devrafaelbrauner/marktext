import type { BinaryOperator, Expr } from './ast'
import { QueryError } from './errors'
import { callFunction, type FunctionContext } from './functions'
import {
  addDuration,
  addDurations,
  compareValues,
  getField,
  isTruthy,
  relativeDate,
  scaleDuration,
  subtractDates,
  typeOf,
  valueToString,
  type DateValue,
  type DurationValue,
  type LinkValue,
  type ObjectValue,
  type Value
} from './values'

export interface EvaluatorEnvironment {
  /** Resolves a link written in the query, relative to the query's file. */
  resolveLink(target: string, display: string | null, subpath?: string | null, embed?: boolean): LinkValue
  /** Page object of a link target, or null when it is not an indexed note. */
  pageOf(link: LinkValue): ObjectValue | null
  /** Clock of the run (epoch ms) for `date(today)` and friends. */
  now: number
  /** Expression nodes one run may evaluate before it fails with `budgetExceeded`. */
  maxSteps: number
}

/** Bindings visible to an expression: the current row and the query's own page (`this`). */
export interface EvaluationScope {
  row: ObjectValue
  thisPage: ObjectValue | null
}

/** Longest string `"text" * n` may produce. */
const MAX_REPEAT_LENGTH = 10_000

const DATE_PARTS: Record<string, (date: Date) => number> = {
  year: (date) => date.getFullYear(),
  month: (date) => date.getMonth() + 1,
  day: (date) => date.getDate(),
  hour: (date) => date.getHours(),
  minute: (date) => date.getMinutes(),
  second: (date) => date.getSeconds(),
  millisecond: (date) => date.getMilliseconds(),
  // ISO weekday: Monday 1 … Sunday 7.
  weekday: (date) => date.getDay() || 7
}

const DURATION_PARTS: Record<string, (duration: DurationValue) => number> = {
  years: (duration) => Math.trunc(duration.months / 12),
  months: (duration) => duration.months % 12,
  days: (duration) => duration.days,
  hours: (duration) => Math.trunc(duration.ms / 3_600_000),
  minutes: (duration) => Math.trunc((duration.ms % 3_600_000) / 60_000),
  seconds: (duration) => (duration.ms % 60_000) / 1000
}

/**
 * Evaluates expressions with Dataview semantics: missing fields are null,
 * arithmetic on null yields null, comparisons order every value (null
 * first), field access on a list maps over it and on a link reads the
 * linked page. One evaluator serves one query run and counts its steps.
 */
export class Evaluator implements FunctionContext {
  readonly now: number
  private steps = 0

  constructor(private readonly env: EvaluatorEnvironment) {
    this.now = env.now
  }

  resolveLink(target: string, display: string | null): LinkValue {
    return this.env.resolveLink(target, display)
  }

  pageOf(link: LinkValue): ObjectValue | null {
    return this.env.pageOf(link)
  }

  evaluate(expr: Expr, scope: EvaluationScope): Value {
    if (++this.steps > this.env.maxSteps) throw new QueryError('budgetExceeded', expr.start)
    switch (expr.kind) {
      case 'literal':
        return expr.value
      case 'link':
        return this.env.resolveLink(expr.target, expr.display, expr.subpath, expr.embed)
      case 'relativeDate':
        return relativeDate(expr.keyword, this.now)
      case 'field':
        if (expr.name === 'this') return scope.thisPage
        if (expr.name === 'row') return scope.row
        return getField(scope.row, expr.name)
      case 'member':
        return this.member(this.evaluate(expr.object, scope), expr.name)
      case 'index':
        return this.index(this.evaluate(expr.object, scope), this.evaluate(expr.index, scope))
      case 'list':
        return expr.items.map((item) => this.evaluate(item, scope))
      case 'call':
        return callFunction(
          expr.name,
          expr.args.map((arg) => this.evaluate(arg, scope)),
          this,
          expr.start
        )
      case 'unary': {
        const operand = this.evaluate(expr.operand, scope)
        if (expr.op === '!') return !isTruthy(operand)
        if (operand === null) return null
        if (typeof operand === 'number') return -operand
        if (typeOf(operand) === 'duration') return scaleDuration(operand as DurationValue, -1)
        throw new QueryError('invalidUnary', expr.start, { op: '-', operand: typeOf(operand) })
      }
      case 'binary': {
        if (expr.op === 'and') return isTruthy(this.evaluate(expr.left, scope)) && isTruthy(this.evaluate(expr.right, scope))
        if (expr.op === 'or') return isTruthy(this.evaluate(expr.left, scope)) || isTruthy(this.evaluate(expr.right, scope))
        return this.binary(expr.op, this.evaluate(expr.left, scope), this.evaluate(expr.right, scope), expr.opStart)
      }
    }
  }

  member(object: Value, name: string): Value {
    switch (typeOf(object)) {
      case 'object':
        return getField(object as ObjectValue, name)
      case 'link': {
        const page = this.env.pageOf(object as LinkValue)
        return page ? getField(page, name) : null
      }
      case 'array':
        return (object as Value[]).map((item) => this.member(item, name))
      case 'date':
        return Object.hasOwn(DATE_PARTS, name.toLowerCase())
          ? DATE_PARTS[name.toLowerCase()](new Date((object as DateValue).ms))
          : null
      case 'duration':
        return Object.hasOwn(DURATION_PARTS, name.toLowerCase())
          ? DURATION_PARTS[name.toLowerCase()](object as DurationValue)
          : null
      default:
        return null
    }
  }

  index(object: Value, index: Value): Value {
    if (typeof index === 'string') return this.member(object, index)
    if (Array.isArray(object) && typeof index === 'number' && Number.isInteger(index)) return object[index] ?? null
    return null
  }

  binary(op: BinaryOperator, left: Value, right: Value, offset: number): Value {
    switch (op) {
      case '=':
        return compareValues(left, right) === 0
      case '!=':
        return compareValues(left, right) !== 0
      case '<':
        return compareValues(left, right) < 0
      case '<=':
        return compareValues(left, right) <= 0
      case '>':
        return compareValues(left, right) > 0
      case '>=':
        return compareValues(left, right) >= 0
      case 'and':
        return isTruthy(left) && isTruthy(right)
      case 'or':
        return isTruthy(left) || isTruthy(right)
    }
    if (left === null || right === null) return null
    const result = arithmetic(op, left, right)
    if (result === undefined) throw new QueryError('invalidOperation', offset, { op, left: typeOf(left), right: typeOf(right) })
    return result
  }
}

/** `+ - * / %` on non-null operands; undefined when the types do not support the operator. */
const arithmetic = (op: BinaryOperator, left: Value, right: Value): Value | undefined => {
  const lt = typeOf(left)
  const rt = typeOf(right)
  if (lt === 'number' && rt === 'number') {
    const a = left as number
    const b = right as number
    switch (op) {
      case '+':
        return a + b
      case '-':
        return a - b
      case '*':
        return a * b
      case '/':
        return b === 0 ? null : a / b
      case '%':
        return b === 0 ? null : a % b
    }
  }
  if (op === '+') {
    if (lt === 'string' || rt === 'string') return valueToString(left) + valueToString(right)
    if (lt === 'array' && rt === 'array') return [...(left as Value[]), ...(right as Value[])]
    if (lt === 'date' && rt === 'duration') return addDuration(left as DateValue, right as DurationValue, 1)
    if (lt === 'duration' && rt === 'date') return addDuration(right as DateValue, left as DurationValue, 1)
    if (lt === 'duration' && rt === 'duration') return addDurations(left as DurationValue, right as DurationValue, 1)
  }
  if (op === '-') {
    if (lt === 'date' && rt === 'duration') return addDuration(left as DateValue, right as DurationValue, -1)
    if (lt === 'date' && rt === 'date') return subtractDates(left as DateValue, right as DateValue)
    if (lt === 'duration' && rt === 'duration') return addDurations(left as DurationValue, right as DurationValue, -1)
  }
  if (op === '*') {
    if (lt === 'duration' && rt === 'number') return scaleDuration(left as DurationValue, right as number)
    if (lt === 'number' && rt === 'duration') return scaleDuration(right as DurationValue, left as number)
    if (lt === 'string' && rt === 'number') {
      const count = right as number
      const text = left as string
      if (!Number.isInteger(count) || count < 0 || text.length * count > MAX_REPEAT_LENGTH) return undefined
      return text.repeat(count)
    }
  }
  if (op === '/' && lt === 'duration' && rt === 'number') {
    return right === 0 ? null : scaleDuration(left as DurationValue, 1 / (right as number))
  }
  return undefined
}
