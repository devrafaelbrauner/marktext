import { describe, expect, it, vi } from 'vitest'
import type { HttpOptions, HttpResponse } from '@capacitor/core'
import { createSafeFetch, type HttpTransport } from '../src/main/plugins/net'

const base64 = (text: string): string => btoa(text)

const replying = (response: Partial<HttpResponse> & { error?: boolean }) =>
  vi.fn<HttpTransport>(async() => ({ status: 200, headers: {}, url: '', data: '', ...response }))

describe('plugin net.fetch policy', () => {
  it.each([
    'http://example.com/',
    'http://192.168.1.10/',
    'http://localhost.evil.com/',
    'http://0.0.0.0/',
    'file:///data/data/app.marktextplus.android/files/plugins.json',
    'ftp://example.com/',
    'content://com.android.externalstorage.documents/tree/x',
    'https://user:pass@example.com/',
    'not a url'
  ])('rejects %s before any request', async(url) => {
    const transport = replying({})
    await expect(createSafeFetch(transport)(url)).rejects.toMatchObject({ name: 'SafeFetchError', code: 'BAD_URL' })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each(['https://api.languagetool.org/v2/check', 'http://127.0.0.1:8081/v2/check', 'http://[::1]/x', 'http://localhost/x'])(
    'allows %s',
    async(url) => {
      const transport = replying({ data: base64('ok'), headers: { 'Content-Type': 'text/plain' } })
      const response = await createSafeFetch(transport)(url)
      expect(response.text()).toBe('ok')
      expect(transport).toHaveBeenCalledOnce()
    }
  )

  it('asks the native client for raw bytes, no redirects and the timeout', async() => {
    const transport = replying({ data: '' })
    await createSafeFetch(transport)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"x"}',
      timeoutMs: 45_000
    })
    const options = transport.mock.calls[0][0] as HttpOptions
    expect(options).toMatchObject({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      data: '{"model":"x"}',
      responseType: 'arraybuffer',
      disableRedirects: true,
      connectTimeout: 45_000,
      readTimeout: 45_000
    })
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('gives form and byte bodies the content type fetch would, bytes as a base64 file body', async() => {
    const transport = replying({})
    const safeFetch = createSafeFetch(transport)
    await safeFetch('https://x.test/', { method: 'POST', body: new URLSearchParams({ text: 'Eu vai', language: 'pt-BR' }) })
    await safeFetch('https://x.test/', { method: 'POST', body: new Uint8Array([0, 255, 1]) })
    const [form, bytes] = transport.mock.calls.map((call) => call[0])
    expect(form.data).toBe('text=Eu+vai&language=pt-BR')
    expect(form.headers?.['Content-Type']).toMatch(/^application\/x-www-form-urlencoded/)
    expect(bytes).toMatchObject({ data: 'AP8B', dataType: 'file', headers: { 'Content-Type': 'application/octet-stream' } })
  })

  it('decodes base64 bodies, re-serialises parsed JSON and keeps error bodies as text', async() => {
    const binary = await createSafeFetch(replying({ data: base64('\u0001\u0002'), headers: { 'Content-Type': 'application/octet-stream' } }))('https://x.test/')
    expect([...binary.body]).toEqual([1, 2])

    const json = await createSafeFetch(replying({ data: { matches: [1] }, headers: { 'Content-Type': 'application/json' } }))('https://x.test/')
    expect(json.json()).toEqual({ matches: [1] })
    expect(json.headers['content-type']).toBe('application/json')

    const failed = await createSafeFetch(replying({ status: 429, error: true, data: 'slow down', headers: { 'Retry-After': '3' } }))('https://x.test/')
    expect(failed).toMatchObject({ status: 429, ok: false, headers: { 'retry-after': '3' } })
    expect(failed.text()).toBe('slow down')
  })

  it('rejects redirects like `redirect: "error"`', async() => {
    const transport = replying({ status: 302, headers: { Location: 'http://169.254.169.254/' } })
    await expect(createSafeFetch(transport)('https://x.test/')).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('enforces the size cap on the declared and the actual length', async() => {
    const declared = replying({ data: base64('tiny'), headers: { 'Content-Length': '999999' } })
    await expect(createSafeFetch(declared)('https://x.test/', { maxResponseBytes: 10 })).rejects.toMatchObject({ code: 'TOO_LARGE' })
    const actual = replying({ data: base64('more than ten bytes') })
    await expect(createSafeFetch(actual)('https://x.test/', { maxResponseBytes: 10 })).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('times out a request the native side never answers, and wraps transport failures', async() => {
    vi.useFakeTimers()
    try {
      const pending = createSafeFetch(() => new Promise(() => {}))('https://x.test/', { timeoutMs: 50 })
      const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(60)
      await assertion
    } finally {
      vi.useRealTimers()
    }
    const failing = vi.fn<HttpTransport>(async() => {
      throw new Error('UnknownHostException')
    })
    await expect(createSafeFetch(failing)('https://x.test/')).rejects.toMatchObject({ code: 'NETWORK', message: 'UnknownHostException' })
  })
})
