import type { SafeFetchInit, SafeFetchResponse } from '../../../main/plugins/types'
import { buildChunks, mapMatchesToBlocks } from '../common/chunking'
import type { PlanLimits } from '../common/plans'
import {
  MAX_REPLACEMENTS,
  type AnnotationPart,
  type CheckBlockInput,
  type CheckResponse,
  type GrammarErrorCode,
  type GrammarErrorInfo,
  type GrammarMatch
} from '../common/types'
import { RateLimiter, SYSTEM_CLOCK, type Clock } from './limiter'

export type FetchLike = (url: string, init?: SafeFetchInit) => Promise<SafeFetchResponse>

export class GrammarError extends Error {
  constructor(
    readonly code: GrammarErrorCode,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'GrammarError'
  }

  toInfo(): GrammarErrorInfo {
    return this.retryAfterMs === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, retryAfterMs: this.retryAfterMs }
  }
}

export interface CheckOptions {
  /** API base ending in `/v2`. */
  baseUrl: string
  language: string
  level: string
  motherTongue: string
  credentials: { username: string; apiKey: string } | null
}

export interface RetryPolicy {
  /** Retries after the first attempt. */
  maxRetries: number
  /** Backoff before retry n (0-based) is `baseDelayMs * 2^n` unless the server sent Retry-After. */
  baseDelayMs: number
  /** Longest wait we accept; a longer Retry-After fails with QUOTA right away. */
  maxDelayMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30_000 }

const REQUEST_TIMEOUT_MS = 30_000
const MAX_ERROR_MESSAGE = 300

/** Variants preferred when the language is detected automatically (spelling needs a variant). */
const AUTO_PREFERRED_VARIANTS = 'pt-BR,en-US,de-DE'

/** Parses Retry-After (delta seconds or HTTP date) into ms from `now`; null when absent or invalid. */
export const parseRetryAfter = (value: string | undefined, now: number): number | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}

export const buildCheckBody = (annotation: AnnotationPart[], options: CheckOptions): URLSearchParams => {
  const params = new URLSearchParams()
  params.set('data', JSON.stringify({ annotation }))
  params.set('language', options.language)
  if (options.language === 'auto') params.set('preferredVariants', AUTO_PREFERRED_VARIANTS)
  if (options.level === 'picky') params.set('level', 'picky')
  if (options.motherTongue.trim()) params.set('motherTongue', options.motherTongue.trim())
  if (options.credentials) {
    params.set('username', options.credentials.username)
    params.set('apiKey', options.credentials.apiKey)
  }
  return params
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** Reads `matches[]` of a /check reply; throws SERVER when the body is not a LanguageTool reply. */
export const parseCheckResponse = (body: unknown): GrammarMatch[] => {
  const raw = asRecord(body).matches
  if (!Array.isArray(raw)) throw new GrammarError('SERVER', 'Malformed LanguageTool response')
  const matches: GrammarMatch[] = []
  for (const item of raw) {
    const match = asRecord(item)
    const { offset, length } = match
    if (typeof offset !== 'number' || typeof length !== 'number' || offset < 0 || length < 0) continue
    const rule = asRecord(match.rule)
    const category = asRecord(rule.category)
    const replacements = Array.isArray(match.replacements)
      ? match.replacements.map((r) => asString(asRecord(r).value)).filter((v) => v.length > 0)
      : []
    const urls = Array.isArray(rule.urls) ? rule.urls.map((u) => asString(asRecord(u).value)).filter(Boolean) : []
    const ruleSubId = asString(rule.subId)
    matches.push({
      offset,
      length,
      message: asString(match.message),
      shortMessage: asString(match.shortMessage),
      replacements: replacements.slice(0, MAX_REPLACEMENTS),
      ruleId: asString(rule.id),
      ...(ruleSubId ? { ruleSubId } : {}),
      ruleDescription: asString(rule.description),
      issueType: asString(rule.issueType),
      categoryId: asString(category.id),
      categoryName: asString(category.name),
      urls
    })
  }
  return matches
}

const errorText = (response: SafeFetchResponse): string => {
  try {
    return response.text().trim().slice(0, MAX_ERROR_MESSAGE)
  } catch {
    return ''
  }
}

/**
 * Maps a failed HTTP reply to an error. LanguageTool answers 401 for bad
 * credentials and 403 both for forbidden access and for exhausted quotas, so
 * 403 bodies mentioning a limit or quota count as QUOTA.
 */
export const classifyHttpError = (response: SafeFetchResponse): GrammarError => {
  const detail = errorText(response)
  const { status } = response
  if (status === 401) return new GrammarError('AUTH', detail || 'Authentication failed')
  if (status === 403) {
    return /limit|quota/i.test(detail)
      ? new GrammarError('QUOTA', detail)
      : new GrammarError('AUTH', detail || 'Access denied')
  }
  if (status === 429) return new GrammarError('QUOTA', detail || 'Rate limit exceeded')
  return new GrammarError('SERVER', `HTTP ${status}${detail ? `: ${detail}` : ''}`)
}

const errorCode = (err: unknown): string | null => {
  const code = asRecord(err).code
  return typeof code === 'string' ? code : null
}

/**
 * LanguageTool HTTP client of the main process: splits blocks into requests
 * below the plan's size limit, waits for the per-minute budget, retries
 * 429/503 and network failures with backoff, and maps results back to blocks.
 */
export class LanguageToolClient {
  private readonly limiter: RateLimiter

  constructor(
    private readonly fetch: FetchLike,
    private readonly limits: PlanLimits,
    private readonly retry: RetryPolicy = DEFAULT_RETRY_POLICY,
    private readonly clock: Clock = SYSTEM_CLOCK
  ) {
    this.limiter = new RateLimiter(limits, clock)
  }

  async check(blocks: CheckBlockInput[], options: CheckOptions): Promise<CheckResponse> {
    const { chunks, oversized } = buildChunks(blocks, this.limits.maxCharsPerRequest)
    const response: CheckResponse = {
      results: oversized.map((key) => ({ key, matches: [] }))
    }
    for (const chunk of chunks) {
      try {
        const matches = await this.send(chunk.annotation, chunk.length, options)
        for (const [key, blockMatches] of mapMatchesToBlocks(chunk, matches)) {
          response.results.push({ key, matches: blockMatches })
        }
      } catch (err) {
        response.error = err instanceof GrammarError ? err.toInfo() : { code: 'SERVER', message: String(err) }
        break
      }
    }
    return response
  }

  private async send(annotation: AnnotationPart[], length: number, options: CheckOptions): Promise<GrammarMatch[]> {
    const body = buildCheckBody(annotation, options).toString()
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire(length)
      let failure: GrammarError
      let retryAfterMs: number | null = null
      try {
        const response = await this.fetch(`${options.baseUrl}/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body,
          timeoutMs: REQUEST_TIMEOUT_MS
        })
        if (response.ok) {
          let json: unknown
          try {
            json = response.json()
          } catch {
            throw new GrammarError('SERVER', 'Malformed LanguageTool response')
          }
          return parseCheckResponse(json)
        }
        failure = classifyHttpError(response)
        if (response.status !== 429 && response.status !== 503) throw failure
        if (response.status === 429) this.limiter.drain()
        retryAfterMs = parseRetryAfter(response.headers['retry-after'], this.clock.now())
      } catch (err) {
        if (err instanceof GrammarError) throw err
        const code = errorCode(err)
        if (code !== 'NETWORK' && code !== 'TIMEOUT') {
          throw new GrammarError(code === 'BAD_URL' ? 'CONFIG' : 'NETWORK', err instanceof Error ? err.message : String(err))
        }
        failure = new GrammarError('NETWORK', err instanceof Error ? err.message : String(err))
      }

      const delay = retryAfterMs ?? this.retry.baseDelayMs * 2 ** attempt
      if (attempt >= this.retry.maxRetries || delay > this.retry.maxDelayMs) {
        throw new GrammarError(failure.code, failure.message, retryAfterMs ?? undefined)
      }
      await this.clock.sleep(delay)
    }
  }

  /** Adds or removes one word of the LanguageTool personal dictionary (Premium). */
  async updateWord(
    action: 'add' | 'delete',
    word: string,
    options: Pick<CheckOptions, 'baseUrl'> & { credentials: { username: string; apiKey: string } }
  ): Promise<void> {
    const params = new URLSearchParams({
      word,
      username: options.credentials.username,
      apiKey: options.credentials.apiKey
    })
    await this.limiter.acquire(0)
    const response = await this.request(`${options.baseUrl}/words/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: params.toString(),
      timeoutMs: REQUEST_TIMEOUT_MS
    })
    if (!response.ok) throw classifyHttpError(response)
  }

  /** Words of the LanguageTool personal dictionary (first 500). */
  async listWords(
    options: Pick<CheckOptions, 'baseUrl'> & { credentials: { username: string; apiKey: string } }
  ): Promise<string[]> {
    const params = new URLSearchParams({
      username: options.credentials.username,
      apiKey: options.credentials.apiKey,
      offset: '0',
      limit: '500'
    })
    await this.limiter.acquire(0)
    const response = await this.request(`${options.baseUrl}/words?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeoutMs: REQUEST_TIMEOUT_MS
    })
    if (!response.ok) throw classifyHttpError(response)
    let json: unknown
    try {
      json = response.json()
    } catch {
      throw new GrammarError('SERVER', 'Malformed LanguageTool response')
    }
    const words = asRecord(json).words
    return Array.isArray(words) ? words.filter((w): w is string => typeof w === 'string') : []
  }

  private async request(url: string, init: SafeFetchInit): Promise<SafeFetchResponse> {
    try {
      return await this.fetch(url, init)
    } catch (err) {
      const code = errorCode(err)
      throw new GrammarError(code === 'BAD_URL' ? 'CONFIG' : 'NETWORK', err instanceof Error ? err.message : String(err))
    }
  }
}
