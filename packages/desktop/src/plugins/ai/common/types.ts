/**
 * Contract of the `complete` IPC method between the AI plugin's renderer part
 * and its main part. Everything here crosses IPC, so it stays plain data.
 */

/**
 * What the model is asked to do with the text. Each action has its own
 * system prompt (main/prompts.ts), model override setting (`<action>Model`
 * in manifest.ts) and command (`ai.<action>` in renderer/index.ts).
 */
export const AI_ACTIONS = ['fixText', 'createTable', 'solveMath', 'research'] as const

export type AiAction = (typeof AI_ACTIONS)[number]

export const isAiAction = (value: unknown): value is AiAction =>
  typeof value === 'string' && (AI_ACTIONS as readonly string[]).includes(value)

/** Largest `text` one `complete` call accepts, in UTF-16 code units. */
export const MAX_INPUT_CHARS = 20_000

export interface CompleteRequest {
  action: AiAction
  /** Markdown the action works on: the text to fix, or the instruction/data/question. */
  text: string
  /** UI language code (`pt`, `en`, …); the reply uses it only when the text's own language is unclear. */
  language?: string
}

/**
 * - CONSENT: the user has not accepted sending text yet; nothing was sent.
 * - NO_KEY / NO_MODEL / CONFIG: settings incomplete or invalid; nothing was sent.
 * - AUTH (401), CREDITS (402), FORBIDDEN (403, e.g. moderation), MODEL_NOT_FOUND
 *   (404, or 400 naming the model id), RATE_LIMIT (429 after retries),
 *   BAD_REQUEST (other 400), SERVER (5xx or a reply that is not a chat completion).
 * - NETWORK / TIMEOUT: no reply from the server.
 * - EMPTY: the model replied without text.
 */
export type AiErrorCode =
  | 'CONSENT'
  | 'NO_KEY'
  | 'NO_MODEL'
  | 'CONFIG'
  | 'AUTH'
  | 'CREDITS'
  | 'FORBIDDEN'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'BAD_REQUEST'
  | 'SERVER'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'EMPTY'

export interface AiErrorInfo {
  code: AiErrorCode
  /** Server or transport detail, untranslated; may be empty. */
  message: string
  /** HTTP status of the failed reply, when there was one. */
  status?: number
  /** Wait the server asked for before retrying, in ms. */
  retryAfterMs?: number
}

export type CompleteResponse =
  | {
    ok: true
    /** Reply as Markdown, trimmed; never empty. */
    text: string
    /** Model id the request used. */
    model: string
  }
  | { ok: false; error: AiErrorInfo }
