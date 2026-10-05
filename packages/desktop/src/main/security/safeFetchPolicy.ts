// URL policy, errors and response shape of `safeFetch`, without the
// transport. Free of Electron and Node imports so the Android build applies
// the same rules over its native HTTP client.

import type { SafeFetchResponse } from '../plugins/types'

export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export type SafeFetchErrorCode = 'BAD_URL' | 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK'

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message)
    this.name = 'SafeFetchError'
    this.code = code
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

const isIPv4 = (host: string): boolean => {
  const match = IPV4.exec(host)
  return !!match && match.slice(1).every((octet) => Number(octet) <= 255)
}

const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost') return true
  if (isIPv4(host)) return host.startsWith('127.')
  return host === '::1'
}

/** The parsed URL when `safeFetch` may reach it, else throws 'BAD_URL'. */
export const checkSafeFetchUrl = (raw: string): URL => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SafeFetchError('BAD_URL', 'Invalid URL')
  }
  if (url.username || url.password) {
    throw new SafeFetchError('BAD_URL', 'Credentials in URL are not allowed')
  }
  if (url.protocol === 'https:') return url
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url
  throw new SafeFetchError('BAD_URL', `URL not allowed: only https, or http to loopback (${url.protocol}//${url.hostname})`)
}

/** Response handed to plugins; `headers` keys must already be lower-cased. */
export const buildSafeFetchResponse = (
  status: number,
  headers: Record<string, string>,
  body: Uint8Array
): SafeFetchResponse => {
  const text = (): string => new TextDecoder().decode(body)
  return {
    status,
    ok: status >= 200 && status <= 299,
    headers,
    body,
    text,
    json: <T = unknown>(): T => JSON.parse(text()) as T
  }
}
