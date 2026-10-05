import { describe, expect, it, vi } from 'vitest'
import { safeFetch, type FetchImpl } from 'main_renderer/security/safeFetch'
import { checkSafeFetchUrl } from 'main_renderer/security/safeFetchPolicy'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

const streamOf = (chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> =>
  new ReadableStream({
    pull(controller) {
      const next = chunks.shift()
      if (next) controller.enqueue(next)
      else controller.close()
    },
    cancel: onCancel
  })

const okFetch = (body: string, headers: Record<string, string> = {}) =>
  vi.fn<FetchImpl>(async() => new Response(body, { status: 200, headers }))

describe('safeFetch URL rules', () => {
  it.each([
    'https://api.languagetool.org/v2/check',
    'http://localhost:8081/v2/check',
    'http://127.0.0.1/x',
    'http://127.255.0.9:1/x',
    'http://[::1]:8010/x'
  ])('allows %s', (url) => {
    expect(() => checkSafeFetchUrl(url)).not.toThrow()
  })

  it.each([
    'http://example.com/',
    'http://192.168.1.10/',
    'http://localhost.evil.com/',
    'http://128.0.0.1/',
    'http://0.0.0.0/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'data:text/plain,hi',
    'https://user:pass@example.com/',
    'not a url'
  ])('rejects %s before any network I/O', async(url) => {
    const fetchImpl = vi.fn<FetchImpl>()
    await expect(safeFetch(url, {}, fetchImpl)).rejects.toMatchObject({ code: 'BAD_URL' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('safeFetch request and response', () => {
  it('forbids redirects and cookies and forwards method, headers and body', async() => {
    const fetchImpl = okFetch('ok')
    await safeFetch('https://a.example/x', { method: 'POST', headers: { 'X-A': '1' }, body: 'q=1' }, fetchImpl)
    const init = fetchImpl.mock.calls[0][1]
    expect(init).toMatchObject({ method: 'POST', headers: { 'X-A': '1' }, body: 'q=1', redirect: 'error', credentials: 'omit' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns status, lower-cased headers, bytes, text and json', async() => {
    const fetchImpl = vi.fn<FetchImpl>(async() =>
      new Response('{"matches":[1]}', { status: 418, headers: { 'Content-Type': 'application/json' } }))
    const res = await safeFetch('https://a.example/x', {}, fetchImpl)
    expect(res.status).toBe(418)
    expect(res.ok).toBe(false)
    expect(res.headers['content-type']).toBe('application/json')
    expect(res.body).toBeInstanceOf(Uint8Array)
    expect(res.text()).toBe('{"matches":[1]}')
    expect(res.json<{ matches: number[] }>().matches).toEqual([1])
  })

  it('json() throws on a non-JSON body', async() => {
    const res = await safeFetch('https://a.example/x', {}, okFetch('<html>'))
    expect(() => res.json()).toThrow()
  })

  it('maps a rejected redirect to a NETWORK error', async() => {
    const fetchImpl = vi.fn<FetchImpl>(async(_url, init) => {
      if (init.redirect === 'error') throw new TypeError('Redirect was blocked')
      return new Response('followed')
    })
    await expect(safeFetch('https://a.example/x', {}, fetchImpl)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('times out with TIMEOUT once the deadline passes', async() => {
    // Executor form: the desktop tsconfig lib predates Promise.withResolvers.
    const fetchImpl = vi.fn<FetchImpl>((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    await expect(safeFetch('https://a.example/x', { timeoutMs: 20 }, fetchImpl)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('accepts a body exactly at the cap', async() => {
    const res = await safeFetch('https://a.example/x', { maxResponseBytes: 4 }, okFetch('abcd'))
    expect(res.text()).toBe('abcd')
  })

  it('stops reading and cancels the stream once the cap is passed', async() => {
    const cancel = vi.fn()
    const chunks = [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)]
    const fetchImpl = vi.fn<FetchImpl>(async() => new Response(streamOf(chunks, cancel)))
    await expect(safeFetch('https://a.example/x', { maxResponseBytes: 5 }, fetchImpl)).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects an over-cap declared length without reading the body', async() => {
    const fetchImpl = okFetch('ab', { 'Content-Length': '999' })
    await expect(safeFetch('https://a.example/x', { maxResponseBytes: 10 }, fetchImpl)).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })
})
