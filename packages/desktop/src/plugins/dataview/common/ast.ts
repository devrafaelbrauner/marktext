import type { Value } from './values'

/** Every node records the `[start, end)` offsets of its source text. */
interface Span {
  start: number
  end: number
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or'

export type Expr =
  | (Span & { kind: 'literal'; value: Value })
  /** `[[target#sub|display]]`, resolved against the query's file when evaluated. */
  | (Span & { kind: 'link'; target: string; subpath: string | null; display: string | null; embed: boolean })
  /** `date(today)`, `date(now)`, … evaluated against the clock of the run. */
  | (Span & { kind: 'relativeDate'; keyword: string })
  | (Span & { kind: 'field'; name: string })
  | (Span & { kind: 'member'; object: Expr; name: string })
  | (Span & { kind: 'index'; object: Expr; index: Expr })
  | (Span & { kind: 'call'; name: string; args: Expr[] })
  | (Span & { kind: 'unary'; op: '!' | '-'; operand: Expr })
  | (Span & { kind: 'binary'; op: BinaryOperator; left: Expr; right: Expr; opStart: number })
  | (Span & { kind: 'list'; items: Expr[] })

export type Source =
  | (Span & { kind: 'tag'; tag: string })
  | (Span & { kind: 'folder'; path: string })
  /** `[[note]]`: files linking to the note. */
  | (Span & { kind: 'incoming'; target: string })
  /** `outgoing([[note]])`: files the note links to. */
  | (Span & { kind: 'outgoing'; target: string })
  | (Span & { kind: 'and' | 'or'; left: Source; right: Source })
  | (Span & { kind: 'not'; source: Source })

export interface TableField {
  expr: Expr
  /** Column header: the `AS` name or the expression's source text. */
  name: string
}

export interface SortKey {
  expr: Expr
  direction: 'asc' | 'desc'
}

export type DataCommand =
  | (Span & { kind: 'where'; expr: Expr })
  | (Span & { kind: 'sort'; keys: SortKey[] })
  | (Span & { kind: 'limit'; count: number })

export type QueryHeader =
  | { type: 'table'; withoutId: boolean; fields: TableField[] }
  | { type: 'list'; withoutId: boolean; expr: Expr | null }
  | { type: 'task' }

export interface Query {
  header: QueryHeader
  source: Source | null
  /** Executed in the written order, like Dataview. */
  commands: DataCommand[]
}
