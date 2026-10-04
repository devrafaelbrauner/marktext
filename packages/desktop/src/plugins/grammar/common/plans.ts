import type { GrammarServer } from './types'

export interface PlanLimits {
  requestsPerMinute: number
  charsPerMinute: number
  /** Largest request body text (annotation text + markup) the server accepts. */
  maxCharsPerRequest: number
}

/**
 * Published LanguageTool limits. A self-hosted server has no fixed limits; it
 * gets the Premium ones so a local instance is never throttled below what the
 * cloud allows.
 */
export const PLAN_LIMITS: Record<GrammarServer, PlanLimits> = {
  premium: { requestsPerMinute: 80, charsPerMinute: 300_000, maxCharsPerRequest: 60_000 },
  free: { requestsPerMinute: 20, charsPerMinute: 75_000, maxCharsPerRequest: 20_000 },
  custom: { requestsPerMinute: 80, charsPerMinute: 300_000, maxCharsPerRequest: 60_000 }
}

export const PREMIUM_BASE_URL = 'https://api.languagetoolplus.com/v2'
export const FREE_BASE_URL = 'https://api.languagetool.org/v2'

const URL_PATTERN = /^https?:\/\//i

export const SERVER_URL_PATTERN = URL_PATTERN.source

export const isGrammarServer = (value: unknown): value is GrammarServer =>
  value === 'premium' || value === 'free' || value === 'custom'

/**
 * API base URL (ending in `/v2`, without trailing slash) for the selected
 * server, or null when a custom URL is missing or not http(s).
 */
export const resolveBaseUrl = (server: GrammarServer, serverUrl: string): string | null => {
  if (server === 'premium') return PREMIUM_BASE_URL
  if (server === 'free') return FREE_BASE_URL
  const trimmed = serverUrl.trim().replace(/\/+$/, '')
  if (!URL_PATTERN.test(trimmed)) return null
  try {
    return new URL(trimmed).host ? trimmed : null
  } catch {
    return null
  }
}
