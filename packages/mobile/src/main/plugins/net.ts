// `ctx.net.fetch` for plugin main parts on Android, with the desktop
// `safeFetch` contract: https or loopback http only, redirects rejected, no
// cookies, a timeout and a response size cap. Requests go through the native
// CapacitorHttp plugin (called directly; it is not patched into
// window.fetch), so they are not subject to the WebView's CORS checks.
//
// Differences forced by CapacitorHttp: the body is buffered natively before
// the size cap applies (the Content-Length check still rejects early), and
// a timed-out request cannot be aborted, only abandoned.

import { CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core'
import type { SafeFetchInit, SafeFetchResponse } from '../../../../desktop/src/main/plugins/types'
import {
  buildSafeFetchResponse,
  checkSafeFetchUrl,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  SafeFetchError
} from '../../../../desktop/src/main/security/safeFetchPolicy'

/** CapacitorHttp.request; replaceable in tests. */
export type HttpTransport = (options: HttpOptions) => Promise<HttpResponse>

const encoder = new TextEncoder()

const hasHeader = (headers: Record<string, string>, name: string): boolean =>
  Object.keys(headers).some((key) => key.toLowerCase() === name)

/**
 * CapacitorHttp request fields for `init`. The native side writes a body only
 * when Content-Type is set, so the defaults `fetch` would pick are applied.
 * Bytes travel base64-encoded as a `file` body.
 */
const requestBody = (init: SafeFetchInit, headers: Record<string, string>): Pick<HttpOptions, 'data' | 'dataType'> => {
  const { body } = init
  if (body === undefined) return {}
  if (typeof body === 'string') {
    if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'text/plain;charset=UTF-8'
    return { data: body }
  }
  if (body instanceof URLSearchParams) {
    if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    return { data: body.toString() }
  }
  if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/octet-stream'
  let binary = ''
  for (const byte of body) binary += String.fromCharCode(byte)
  return { data: btoa(binary), dataType: 'file' }
}

const fromBase64 = (data: string): Uint8Array => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Response bytes. With `responseType: 'arraybuffer'` the native side returns
 * base64, except for JSON (parsed) and error statuses (text or parsed JSON).
 */
const responseBody = (response: HttpResponse, contentType: string): Uint8Array => {
  const { data } = response
  if (data === null || data === undefined) return new Uint8Array()
  if (typeof data !== 'string') return encoder.encode(JSON.stringify(data))
  const isErrorBody = (response as HttpResponse & { error?: boolean }).error === true
  if (isErrorBody || contentType.includes('application/json')) return encoder.encode(data)
  return fromBase64(data)
}

/** Builds the plugin `net.fetch` over `transport` (CapacitorHttp by default). */
export const createSafeFetch = (transport: HttpTransport = (options) => CapacitorHttp.request(options)) =>
  async(url: string, init: SafeFetchInit = {}): Promise<SafeFetchResponse> => {
    const target = checkSafeFetchUrl(url)
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = init.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    const headers = { ...init.headers }
    const options: HttpOptions = {
      url: target.href,
      method: init.method ?? 'GET',
      headers,
      ...requestBody(init, headers),
      responseType: 'arraybuffer',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      disableRedirects: true
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new SafeFetchError('TIMEOUT', `Request timed out after ${timeoutMs} ms`)),
        timeoutMs
      )
    })
    let response: HttpResponse
    try {
      response = await Promise.race([transport(options), timeout])
    } catch (err) {
      if (err instanceof SafeFetchError) throw err
      throw new SafeFetchError('NETWORK', err instanceof Error ? err.message : String(err))
    } finally {
      clearTimeout(timer)
    }

    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      // HttpURLConnection lists the status line under a null key.
      if (key && key !== 'null') responseHeaders[key.toLowerCase()] = String(value)
    }
    // Desktop fetch runs with `redirect: 'error'`; a redirect never reaches the plugin.
    if (response.status >= 300 && response.status < 400 && responseHeaders.location !== undefined) {
      throw new SafeFetchError('NETWORK', `Redirect to ${responseHeaders.location} rejected`)
    }
    const declared = Number.parseInt(responseHeaders['content-length'] ?? '', 10)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new SafeFetchError('TOO_LARGE', `Response exceeds ${maxBytes} bytes`)
    }
    const body = responseBody(response, responseHeaders['content-type'] ?? '')
    if (body.byteLength > maxBytes) throw new SafeFetchError('TOO_LARGE', `Response exceeds ${maxBytes} bytes`)
    return buildSafeFetchResponse(response.status, responseHeaders, body)
  }
