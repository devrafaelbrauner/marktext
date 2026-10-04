/**
 * Errors of parsing and evaluating a query. They carry a message code and
 * parameters instead of text so the renderer can show them in the UI
 * language (`errors.<code>` in the plugin locales).
 */

export type QueryErrorCode =
  | 'invalidCharacter'
  | 'unterminatedString'
  | 'unterminatedLink'
  | 'invalidLink'
  | 'invalidTag'
  | 'expectedQueryType'
  | 'unsupportedQueryType'
  | 'unsupportedCommand'
  | 'unexpectedToken'
  | 'unexpectedEnd'
  | 'expectedExpression'
  | 'missingExpression'
  | 'expectedField'
  | 'trailingInput'
  | 'expectedSource'
  | 'fromNotFirst'
  | 'invalidLimit'
  | 'invalidDate'
  | 'invalidDuration'
  | 'unknownFunction'
  | 'argumentCount'
  | 'invalidOperation'
  | 'invalidUnary'
  | 'invalidArgument'
  | 'budgetExceeded'
  | 'queryTooLong'

export type QueryErrorParams = Record<string, string | number>

export class QueryError extends Error {
  readonly code: QueryErrorCode
  readonly params: QueryErrorParams
  /** UTF-16 offset in the query text where the problem starts. */
  readonly offset: number

  constructor(code: QueryErrorCode, offset: number, params: QueryErrorParams = {}) {
    super(`${code} at ${offset}`)
    this.name = 'QueryError'
    this.code = code
    this.params = params
    this.offset = offset
  }
}

/** Serializable form of a `QueryError`; `line` and `column` are 1-based. */
export interface QueryErrorInfo {
  code: QueryErrorCode
  params: QueryErrorParams
  offset: number
  line: number
  column: number
}

export const toErrorInfo = (error: QueryError, text: string): QueryErrorInfo => {
  const offset = Math.max(0, Math.min(error.offset, text.length))
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - (before.lastIndexOf('\n') + 1) + 1
  return { code: error.code, params: error.params, offset, line, column }
}
