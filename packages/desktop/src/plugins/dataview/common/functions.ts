import type { BinaryOperator } from './ast'
import { QueryError } from './errors'
import {
  compareValues,
  getField,
  hasEntry,
  isTruthy,
  parseDateText,
  parseDurationText,
  relativeDate,
  typeOf,
  valueToString,
  valuesEqual,
  type LinkValue,
  type ObjectValue,
  type Value
} from './values'

/** What the built-in functions need from the running query. */
export interface FunctionContext {
  /** Resolves a link target relative to the query's file. */
  resolveLink(target: string, display: string | null): LinkValue
  /** The page a link points to, or null when it is not an indexed note. */
  pageOf(link: LinkValue): ObjectValue | null
  binary(op: BinaryOperator, left: Value, right: Value, offset: number): Value
  now: number
}

type BuiltinFunction = (args: Value[], context: FunctionContext, offset: number) => Value

interface FunctionDefinition {
  min: number
  max: number
  run: BuiltinFunction
}

const invalidArgument = (name: string, value: Value, offset: number): QueryError =>
  new QueryError('invalidArgument', offset, { name, type: typeOf(value) })

/** Applies `fn` to each element of a list argument (Dataview "vectorized" functions). */
const vectorized =
  (fn: (value: Value, rest: Value[], context: FunctionContext, offset: number) => Value): BuiltinFunction =>
    (args, context, offset) => {
      const [first, ...rest] = args
      if (Array.isArray(first)) return first.map((item) => fn(item, rest, context, offset))
      return fn(first, rest, context, offset)
    }

const contains = (haystack: Value, needle: Value): boolean => {
  if (Array.isArray(haystack)) return haystack.some((item) => contains(item, needle))
  if (typeof haystack === 'string' && typeof needle === 'string') return haystack.includes(needle)
  if (typeOf(haystack) === 'object' && typeof needle === 'string') return hasEntry((haystack as ObjectValue).entries, needle)
  return valuesEqual(haystack, needle)
}

const extremum = (args: Value[], sign: 1 | -1): Value => {
  const values = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).filter((value) => value !== null)
  let best: Value = null
  for (const value of values) {
    if (best === null || sign * compareValues(value, best) > 0) best = value
  }
  return best
}

const stringTest =
  (name: string, test: (text: string, part: string) => boolean): BuiltinFunction =>
    ([text, part], _context, offset) => {
      if (text === null || part === null) return false
      if (typeof text !== 'string') throw invalidArgument(name, text, offset)
      if (typeof part !== 'string') throw invalidArgument(name, part, offset)
      return test(text, part)
    }

const FIRST_NUMBER = /-?\d+(?:\.\d+)?/

const FUNCTIONS: Record<string, FunctionDefinition> = {
  contains: { min: 2, max: 2, run: ([haystack, needle]) => haystack !== null && contains(haystack, needle) },
  length: {
    min: 1,
    max: 1,
    run: ([value]) => {
      if (Array.isArray(value) || typeof value === 'string') return value.length
      if (typeOf(value) === 'object') return Object.keys((value as ObjectValue).entries).length
      return 0
    }
  },
  lower: {
    min: 1,
    max: 1,
    run: vectorized((value, _rest, _context, offset) => {
      if (value === null || typeof value === 'string') return value?.toLowerCase() ?? null
      throw invalidArgument('lower', value, offset)
    })
  },
  upper: {
    min: 1,
    max: 1,
    run: vectorized((value, _rest, _context, offset) => {
      if (value === null || typeof value === 'string') return value?.toUpperCase() ?? null
      throw invalidArgument('upper', value, offset)
    })
  },
  default: {
    min: 2,
    max: 2,
    run: ([value, fallback]) => {
      if (Array.isArray(value)) return value.map((item) => (item === null ? fallback : item))
      return value === null ? fallback : value
    }
  },
  choice: { min: 3, max: 3, run: ([condition, yes, no]) => (isTruthy(condition) ? yes : no) },
  round: {
    min: 1,
    max: 2,
    run: vectorized((value, [digits], _context, offset) => {
      if (value === null) return null
      if (typeof value !== 'number') throw invalidArgument('round', value, offset)
      if (digits !== undefined && digits !== null && typeof digits !== 'number') throw invalidArgument('round', digits, offset)
      const factor = 10 ** Math.max(0, Math.trunc(digits ?? 0))
      return Math.round(value * factor) / factor
    })
  },
  min: { min: 1, max: Infinity, run: (args) => extremum(args, -1) },
  max: { min: 1, max: Infinity, run: (args) => extremum(args, 1) },
  sum: {
    min: 1,
    max: 1,
    run: ([list], context, offset) => {
      if (list === null) return null
      if (!Array.isArray(list)) return list
      const values = list.filter((value) => value !== null)
      if (values.length === 0) return null
      return values.slice(1).reduce((total: Value, value) => context.binary('+', total, value, offset), values[0])
    }
  },
  typeof: { min: 1, max: 1, run: ([value]) => typeOf(value) },
  startswith: { min: 2, max: 2, run: stringTest('startswith', (text, part) => text.startsWith(part)) },
  endswith: { min: 2, max: 2, run: stringTest('endswith', (text, part) => text.endsWith(part)) },
  date: {
    min: 1,
    max: 1,
    run: ([value], context, offset) => {
      switch (typeOf(value)) {
        case 'null':
          return null
        case 'date':
          return value
        case 'string':
          return relativeDate(value as string, context.now) ?? parseDateText(value as string)
        case 'link': {
          const page = context.pageOf(value as LinkValue)
          const file = page ? getField(page, 'file') : null
          return file !== null && typeOf(file) === 'object' ? getField(file as ObjectValue, 'day') : null
        }
        default:
          throw invalidArgument('date', value, offset)
      }
    }
  },
  dur: {
    min: 1,
    max: 1,
    run: ([value], _context, offset) => {
      if (value === null || typeOf(value) === 'duration') return value
      if (typeof value === 'string') return parseDurationText(value)
      throw invalidArgument('dur', value, offset)
    }
  },
  link: {
    min: 1,
    max: 2,
    run: vectorized((value, [display], context, offset) => {
      if (value === null) return null
      if (display !== undefined && display !== null && typeof display !== 'string') throw invalidArgument('link', display, offset)
      if (typeOf(value) === 'link') return display ? { ...(value as LinkValue), display } : value
      if (typeof value !== 'string') throw invalidArgument('link', value, offset)
      return context.resolveLink(value, display ?? null)
    })
  },
  number: {
    min: 1,
    max: 1,
    run: ([value]) => {
      if (typeof value === 'number') return value
      if (typeof value !== 'string') return null
      const match = FIRST_NUMBER.exec(value)
      return match ? Number(match[0]) : null
    }
  },
  string: { min: 1, max: 1, run: ([value]) => valueToString(value) },
  list: { min: 0, max: Infinity, run: (args) => args },
  join: {
    min: 1,
    max: 2,
    run: ([list, separator], _context, offset) => {
      if (separator !== undefined && separator !== null && typeof separator !== 'string') {
        throw invalidArgument('join', separator, offset)
      }
      const items = Array.isArray(list) ? list : [list]
      return items.map(valueToString).join(separator ?? ', ')
    }
  }
}

/** `[min, max]` argument counts of the built-in functions, keyed by lower-case name (checked by the parser). */
export const FUNCTION_ARITY: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(FUNCTIONS).map(([name, definition]) => [name, [definition.min, definition.max]])
)

export const callFunction = (name: string, args: Value[], context: FunctionContext, offset: number): Value => {
  if (!Object.hasOwn(FUNCTIONS, name)) throw new QueryError('unknownFunction', offset, { name })
  const definition = FUNCTIONS[name]
  return definition.run(args, context, offset)
}
