import { net } from 'electron'
import { isIP } from 'net'
import type { SafeFetchInit, SafeFetchResponse } from '../plugins/types'

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

/** `net.fetch`, narrowed to what `safeFetch` needs; replaceable in tests. */
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost') return true
  if (isIP(host) === 4) return host.startsWith('127.')
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

const readCapped = async(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> => {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) throw new SafeFetchError('TOO_LARGE', `Response exceeds ${max} bytes`)
      chunks.push(value)
    }
  } finally {
    // Closes the socket when leaving early instead of letting the server keep streaming.
    await reader.cancel().catch(() => {})
  }
  const data = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    data.set(chunk, at)
    at += chunk.byteLength
  }
  return data
}

/**
 * HTTP(S) request for plugins: redirects rejected (a redirect would reach a
 * host the URL check never saw), no cookies, a timeout covering the whole
 * exchange and a streamed size cap. Rejects with `SafeFetchError`.
 */
export const safeFetch = async(
  url: string,
  init: SafeFetchInit = {},
  fetchImpl: FetchImpl = (u, i) => net.fetch(u, i)
): Promise<SafeFetchResponse> => {
  const target = checkSafeFetchUrl(url)
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = init.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetchImpl(target.href, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit'
    })

    const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {})
      throw new SafeFetchError('TOO_LARGE', `Response exceeds ${maxBytes} bytes`)
    }

    const body = await readCapped(response.body, maxBytes)
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const text = (): string => new TextDecoder().decode(body)
    return {
      status: response.status,
      ok: response.ok,
      headers,
      body,
      text,
      json: <T = unknown>(): T => JSON.parse(text()) as T
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err
    if (timedOut) throw new SafeFetchError('TIMEOUT', `Request timed out after ${timeoutMs} ms`)
    throw new SafeFetchError('NETWORK', err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}
