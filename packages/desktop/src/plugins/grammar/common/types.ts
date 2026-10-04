import type { AnnotationPart } from '@/plugins/types'

export type { AnnotationPart } from '@/plugins/types'

export type GrammarServer = 'premium' | 'free' | 'custom'

/**
 * A LanguageTool match reduced to what the UI needs. `offset`/`length` are
 * UTF-16 positions in the text of the block it belongs to (markup included).
 */
export interface GrammarMatch {
  offset: number
  length: number
  message: string
  shortMessage: string
  /** At most `MAX_REPLACEMENTS` suggestions, best first. */
  replacements: string[]
  ruleId: string
  ruleSubId?: string
  ruleDescription: string
  /** LanguageTool issue type, e.g. 'misspelling', 'grammar', 'style', 'typographical'. */
  issueType: string
  categoryId: string
  categoryName: string
  /** Rule documentation links as returned by the server (not yet filtered by scheme). */
  urls: string[]
}

export const MAX_REPLACEMENTS = 5

/** One block to check; `key` is opaque to the main part and echoed back. */
export interface CheckBlockInput {
  key: string
  annotation: AnnotationPart[]
}

export interface CheckBlockResult {
  key: string
  matches: GrammarMatch[]
}

/**
 * - AUTH: credentials rejected (401/403);
 * - QUOTA: rate limit or daily quota hit (429 after retries);
 * - NETWORK: server unreachable or timed out;
 * - SERVER: any other unexpected answer (4xx/5xx, malformed body);
 * - CONSENT: the user has not agreed to send text yet;
 * - CONFIG: the selected server cannot be used as configured (missing
 *   Premium credentials, invalid custom URL).
 */
export type GrammarErrorCode = 'AUTH' | 'QUOTA' | 'NETWORK' | 'SERVER' | 'CONSENT' | 'CONFIG'

export interface GrammarErrorInfo {
  code: GrammarErrorCode
  message: string
  /** For QUOTA: how long the server asked to wait, in ms. */
  retryAfterMs?: number
}

/**
 * Reply of the main part's `check` method. Results of the requests that
 * completed are returned even when a later request failed; blocks absent
 * from `results` were not checked.
 */
export interface CheckResponse {
  results: CheckBlockResult[]
  error?: GrammarErrorInfo
}

/** Settings that change what the server answers; part of the result cache key. */
export interface RequestSettings {
  server: GrammarServer
  serverUrl: string
  language: string
  level: string
  motherTongue: string
  username: string
}
