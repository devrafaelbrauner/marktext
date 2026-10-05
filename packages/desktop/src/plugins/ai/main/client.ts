import type { SafeFetchInit, SafeFetchResponse } from '../../../main/plugins/types'
import { DEFAULT_RETRY_POLICY, parseRetryAfter, type RetryPolicy } from '@plugins/grammar/main/client'
import { RateLimiter, SYSTEM_CLOCK, type Clock } from '@plugins/grammar/main/limiter'
import type { AiErrorCode, AiErrorInfo } from '../common/types'

export type FetchLike = (url: string, init?: SafeFetchInit) => Promise<SafeFetchResponse>

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionOptions {
  /** API base without trailing slash, e.g. `https://openrouter.ai/api/v1`. */
  baseUrl: string
  apiKey: string
  /** OpenRouter model id, e.g. `openai/gpt-4o-mini`. */
  model: string
  messages: ChatMessage[]
}

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'AiError'
  }

  toInfo(): AiErrorInfo {
    const info: AiErrorInfo = { code: this.code, message: this.message }
    if (this.status !== undefined) info.status = this.status
    if (this.retryAfterMs !== undefined) info.retryAfterMs = this.retryAfterMs
    return info
  }
}

/**
 * Reasoning models can think for a long time before the first byte; the reply
 * is buffered (safeFetch has no streaming), so the whole answer must arrive
 * within this window.
 */
export const REQUEST_TIMEOUT_MS = 60_000

/**
 * Client-side budget shared by all windows. OpenRouter's own limit for free
 * models is 20 requests/minute; paid models allow more, but these commands
 * are user-triggered, so the free tier's limit never gets in the way.
 */
export const OPENROUTER_LIMITS = { requestsPerMinute: 20, charsPerMinute: 400_000 }

/** Attribution headers OpenRouter uses to identify the calling app (https://openrouter.ai/docs/api-reference/overview). */
export const APP_HEADERS = {
  'HTTP-Referer': 'https://github.com/devrafaelbrauner/marktext',
  'X-Title': 'MarkText Plus'
}

const MAX_ERROR_MESSAGE = 300

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** Message of an OpenAI-style `{ error: { message } }` body, else the raw text; truncated. */
const errorDetail = (response: SafeFetchResponse): string => {
  let text = ''
  try {
    text = response.text().trim()
  } catch {
    return ''
  }
  try {
    const message = asRecord(asRecord(JSON.parse(text)).error).message
    if (typeof message === 'string' && message.trim()) text = message.trim()
  } catch {
    // Not JSON: keep the raw text.
  }
  return text.slice(0, MAX_ERROR_MESSAGE)
}

/**
 * Maps an HTTP status to an error code. OpenRouter answers 400 (not 404) for
 * a model id it does not know ("… is not a valid model ID"), so a 400 whose
 * message is about the model id counts as MODEL_NOT_FOUND.
 */
export const classifyStatus = (status: number, detail: string): AiError => {
  const message = detail || `HTTP ${status}`
  if (status === 400) {
    return new AiError(/model/i.test(detail) && /\b(valid|exist|found|unknown)/i.test(detail) ? 'MODEL_NOT_FOUND' : 'BAD_REQUEST', message, status)
  }
  if (status === 401) return new AiError('AUTH', message, status)
  if (status === 402) return new AiError('CREDITS', message, status)
  if (status === 403) return new AiError('FORBIDDEN', message, status)
  if (status === 404) return new AiError('MODEL_NOT_FOUND', message, status)
  if (status === 408) return new AiError('TIMEOUT', message, status)
  if (status === 429) return new AiError('RATE_LIMIT', message, status)
  return new AiError('SERVER', message, status)
}

/** Text of a message `content`: a string, or an array of `{ type: 'text', text }` parts. */
const contentText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => asRecord(part))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

/**
 * Reply text of a chat completion body. Throws AiError: the mapped code when
 * the body carries an `error` (OpenRouter can report provider failures that
 * way with HTTP 200), SERVER when it is not a chat completion, EMPTY when the
 * model produced no text.
 */
export const parseCompletion = (body: unknown): string => {
  const record = asRecord(body)
  const choice = asRecord(Array.isArray(record.choices) ? record.choices[0] : undefined)
  const error = asRecord(record.error ?? choice.error)
  if (Object.keys(error).length > 0) {
    const status = typeof error.code === 'number' ? error.code : 500
    const message = typeof error.message === 'string' ? error.message.slice(0, MAX_ERROR_MESSAGE) : ''
    throw classifyStatus(status, message)
  }
  if (!Array.isArray(record.choices)) throw new AiError('SERVER', 'Malformed chat completion response')
  const text = contentText(asRecord(choice.message).content)
  if (!text.trim()) throw new AiError('EMPTY', 'The model returned no text')
  return text
}

const errorCode = (err: unknown): string | null => {
  const code = asRecord(err).code
  return typeof code === 'string' ? code : null
}

/**
 * OpenRouter chat completions client of the main process: one buffered
 * request per call, throttled by a per-minute budget, retrying 429/502/503
 * replies (honouring Retry-After) and connection failures with backoff. A
 * timeout is not retried: the model may still be working, and repeating the
 * call would bill it again.
 */
export class OpenRouterClient {
  private readonly limiter: RateLimiter

  constructor(
    private readonly fetch: FetchLike,
    private readonly retry: RetryPolicy = DEFAULT_RETRY_POLICY,
    private readonly clock: Clock = SYSTEM_CLOCK
  ) {
    this.limiter = new RateLimiter(OPENROUTER_LIMITS, clock)
  }

  /** Reply text of `options.messages`; rejects with AiError. */
  async complete(options: CompletionOptions): Promise<string> {
    const body = JSON.stringify({ model: options.model, messages: options.messages })
    const chars = options.messages.reduce((total, message) => total + message.content.length, 0)
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire(chars)
      let failure: AiError
      let retryAfterMs: number | null = null
      try {
        const response = await this.fetch(`${options.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...APP_HEADERS
          },
          body,
          timeoutMs: REQUEST_TIMEOUT_MS
        })
        if (response.ok) {
          let json: unknown
          try {
            json = response.json()
          } catch {
            throw new AiError('SERVER', 'Malformed chat completion response', response.status)
          }
          return parseCompletion(json)
        }
        failure = classifyStatus(response.status, errorDetail(response))
        if (response.status !== 429 && response.status !== 502 && response.status !== 503) throw failure
        if (response.status === 429) this.limiter.drain()
        retryAfterMs = parseRetryAfter(response.headers['retry-after'], this.clock.now())
      } catch (err) {
        if (err instanceof AiError) throw err
        const message = err instanceof Error ? err.message : String(err)
        const code = errorCode(err)
        if (code === 'TIMEOUT') throw new AiError('TIMEOUT', message)
        if (code !== 'NETWORK') throw new AiError(code === 'BAD_URL' ? 'CONFIG' : 'NETWORK', message)
        failure = new AiError('NETWORK', message)
      }

      const delay = retryAfterMs ?? this.retry.baseDelayMs * 2 ** attempt
      if (attempt >= this.retry.maxRetries || delay > this.retry.maxDelayMs) {
        throw new AiError(failure.code, failure.message, failure.status, retryAfterMs ?? undefined)
      }
      await this.clock.sleep(delay)
    }
  }
}
