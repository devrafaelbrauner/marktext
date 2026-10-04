import { describe, expect, it } from 'vitest'
import type { SafeFetchInit, SafeFetchResponse } from '../../../../../src/main/plugins/types'
import {
  LanguageToolClient,
  parseCheckResponse,
  parseRetryAfter,
  type CheckOptions,
  type RetryPolicy
} from '@plugins/grammar/main/client'
import { RateLimiter, type Clock } from '@plugins/grammar/main/limiter'
import type { PlanLimits } from '@plugins/grammar/common/plans'

class FakeClock implements Clock {
  time = 1_000_000
  readonly sleeps: number[] = []
  now(): number {
    return this.time
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms)
    this.time += ms
  }
}

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): SafeFetchResponse => {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    body: new TextEncoder().encode(text),
    text: () => text,
    json: <T>() => JSON.parse(text) as T
  }
}

const ltMatch = (offset: number, length: number, extra: Record<string, unknown> = {}) => ({
  message: 'Possível erro de concordância.',
  shortMessage: 'Concordância',
  offset,
  length,
  replacements: [{ value: 'vou' }],
  context: { text: '', offset: 0, length: 0 },
  sentence: '',
  rule: {
    id: 'PT_VERB_AGREEMENT',
    description: 'Concordância verbal',
    issueType: 'grammar',
    urls: [{ value: 'https://languagetool.org/rule' }],
    category: { id: 'GRAMMAR', name: 'Gramática' }
  },
  ...extra
})

interface Call {
  url: string
  init?: SafeFetchInit
  params: URLSearchParams
}

const scripted = (replies: Array<SafeFetchResponse | Error | ((call: Call) => SafeFetchResponse)>) => {
  const calls: Call[] = []
  const fetch = async(url: string, init?: SafeFetchInit): Promise<SafeFetchResponse> => {
    const call = { url, init, params: new URLSearchParams(typeof init?.body === 'string' ? init.body : '') }
    calls.push(call)
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply(call) : reply
  }
  return { fetch, calls }
}

const networkError = (code: string): Error => Object.assign(new Error(`${code} failure`), { code })

const LIMITS: PlanLimits = { requestsPerMinute: 80, charsPerMinute: 300_000, maxCharsPerRequest: 60_000 }
const RETRY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30_000 }
const OPTIONS: CheckOptions = {
  baseUrl: 'https://api.languagetoolplus.com/v2',
  language: 'pt-BR',
  level: 'default',
  motherTongue: 'pt-BR',
  credentials: { username: 'me@example.com', apiKey: 'secret-key' }
}
const BLOCK = { key: 'k', annotation: [{ text: 'Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }] }

describe('LanguageTool request', () => {
  it('posts the annotation with language, level, mother tongue and Premium credentials', async() => {
    const { fetch, calls } = scripted([respond(200, { matches: [] })])
    await new LanguageToolClient(fetch, LIMITS, RETRY, new FakeClock()).check([BLOCK], { ...OPTIONS, level: 'picky' })
    const [call] = calls
    expect(call.url).toBe('https://api.languagetoolplus.com/v2/check')
    expect(call.init?.method).toBe('POST')
    expect(call.init?.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(JSON.parse(call.params.get('data') ?? '')).toEqual({ annotation: BLOCK.annotation })
    expect(call.params.get('language')).toBe('pt-BR')
    expect(call.params.get('level')).toBe('picky')
    expect(call.params.get('motherTongue')).toBe('pt-BR')
    expect(call.params.get('username')).toBe('me@example.com')
    expect(call.params.get('apiKey')).toBe('secret-key')
    expect(call.params.has('preferredVariants')).toBe(false)
  })

  it('omits credentials and the default level, and sends preferred variants for auto', async() => {
    const { fetch, calls } = scripted([respond(200, { matches: [] })])
    await new LanguageToolClient(fetch, LIMITS, RETRY, new FakeClock()).check([BLOCK], {
      ...OPTIONS,
      baseUrl: 'https://api.languagetool.org/v2',
      language: 'auto',
      credentials: null
    })
    const { params } = calls[0]
    expect(params.has('username')).toBe(false)
    expect(params.has('apiKey')).toBe(false)
    expect(params.has('level')).toBe(false)
    expect(params.get('language')).toBe('auto')
    expect(params.get('preferredVariants')).toBe('pt-BR,en-US,de-DE')
  })

  it('splits blocks into requests under the size limit and maps offsets back per block', async() => {
    const blocks = [
      { key: 'a', annotation: [{ text: 'Nós vai.' }] },
      { key: 'b', annotation: [{ text: 'Eles foi.' }] },
      { key: 'c', annotation: [{ text: 'Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }] }
    ]
    const { fetch, calls } = scripted([
      // `Nós vai.\n\nEles foi.` — matches at 4 (block a) and 15 (block b, offset 5).
      respond(200, { matches: [ltMatch(4, 3), ltMatch(15, 3)] }),
      respond(200, { matches: [ltMatch(0, 8)] })
    ])
    const response = await new LanguageToolClient(fetch, { ...LIMITS, maxCharsPerRequest: 20 }, RETRY, new FakeClock()).check(
      blocks,
      OPTIONS
    )
    expect(calls).toHaveLength(2)
    expect(response.error).toBeUndefined()
    expect(response.results.map((r) => [r.key, r.matches.map((m) => [m.offset, m.length])])).toEqual([
      ['a', [[4, 3]]],
      ['b', [[5, 3]]],
      ['c', [[0, 8]]]
    ])
  })

  it('returns results of completed requests together with the error of a failed one', async() => {
    const blocks = [
      { key: 'a', annotation: [{ text: 'x'.repeat(15) }] },
      { key: 'b', annotation: [{ text: 'y'.repeat(15) }] }
    ]
    const { fetch } = scripted([respond(200, { matches: [] }), respond(401, 'invalid key')])
    const response = await new LanguageToolClient(fetch, { ...LIMITS, maxCharsPerRequest: 20 }, RETRY, new FakeClock()).check(
      blocks,
      OPTIONS
    )
    expect(response.results).toEqual([{ key: 'a', matches: [] }])
    expect(response.error).toEqual({ code: 'AUTH', message: 'invalid key' })
  })

  it('normalizes matches and keeps at most five replacements', () => {
    const [m] = parseCheckResponse({
      matches: [
        ltMatch(1, 2, {
          replacements: ['a', 'b', 'c', 'd', 'e', 'f'].map((value) => ({ value })),
          rule: { id: 'X', subId: '2', description: 'd', issueType: 'misspelling', urls: [], category: { id: 'TYPOS', name: 'Erros' } }
        }),
        { offset: 'bad', length: 1 }
      ]
    })
    expect(m).toEqual({
      offset: 1,
      length: 2,
      message: 'Possível erro de concordância.',
      shortMessage: 'Concordância',
      replacements: ['a', 'b', 'c', 'd', 'e'],
      ruleId: 'X',
      ruleSubId: '2',
      ruleDescription: 'd',
      issueType: 'misspelling',
      categoryId: 'TYPOS',
      categoryName: 'Erros',
      urls: []
    })
    expect(() => parseCheckResponse({ software: {} })).toThrow(/Malformed/)
  })
})

describe('LanguageTool retries and errors', () => {
  const run = async(replies: Parameters<typeof scripted>[0]) => {
    const clock = new FakeClock()
    const { fetch, calls } = scripted(replies)
    const response = await new LanguageToolClient(fetch, LIMITS, RETRY, clock).check([BLOCK], OPTIONS)
    return { response, calls, sleeps: clock.sleeps }
  }

  it('retries 503 with exponential backoff', async() => {
    const { response, calls, sleeps } = await run([respond(503, ''), respond(503, ''), respond(200, { matches: [ltMatch(0, 8)] })])
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([1000, 2000])
    expect(response.results[0].matches).toHaveLength(1)
  })

  it('honours Retry-After on 429', async() => {
    const { response, sleeps } = await run([respond(429, 'Too many', { 'retry-after': '7' }), respond(200, { matches: [] })])
    expect(sleeps).toContain(7000)
    expect(response.error).toBeUndefined()
  })

  it('gives up after the retry budget and reports the last failure', async() => {
    const { response, calls, sleeps } = await run([respond(503, 'busy'), respond(503, 'busy'), respond(503, 'busy'), respond(503, 'busy')])
    expect(calls).toHaveLength(4)
    expect(sleeps).toEqual([1000, 2000, 4000])
    expect(response.error).toEqual({ code: 'SERVER', message: 'HTTP 503: busy' })
  })

  it('fails with QUOTA right away when Retry-After is longer than the longest accepted wait', async() => {
    const { response, calls, sleeps } = await run([respond(429, 'quota', { 'retry-after': '120' })])
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
    expect(response.error).toEqual({ code: 'QUOTA', message: 'quota', retryAfterMs: 120_000 })
  })

  it('classifies HTTP failures without retrying them', async() => {
    expect((await run([respond(401, '')])).response.error?.code).toBe('AUTH')
    expect((await run([respond(403, 'Access denied')])).response.error?.code).toBe('AUTH')
    expect((await run([respond(403, 'Daily request limit exceeded')])).response.error?.code).toBe('QUOTA')
    const bad = await run([respond(400, "Error: 'pt-XX' is not a language code")])
    expect(bad.calls).toHaveLength(1)
    expect(bad.response.error).toEqual({ code: 'SERVER', message: "HTTP 400: Error: 'pt-XX' is not a language code" })
    expect((await run([respond(200, '<html>')])).response.error).toEqual({ code: 'SERVER', message: 'Malformed LanguageTool response' })
  })

  it('retries network failures and timeouts, then reports NETWORK', async() => {
    const recovered = await run([networkError('TIMEOUT'), respond(200, { matches: [] })])
    expect(recovered.response.error).toBeUndefined()
    expect(recovered.sleeps).toEqual([1000])

    const offline = await run([networkError('NETWORK'), networkError('NETWORK'), networkError('NETWORK'), networkError('NETWORK')])
    expect(offline.response.error?.code).toBe('NETWORK')
    expect(offline.calls).toHaveLength(4)
  })

  it('reports a refused URL as a configuration problem without retrying', async() => {
    const { response, calls } = await run([networkError('BAD_URL')])
    expect(calls).toHaveLength(1)
    expect(response.error?.code).toBe('CONFIG')
  })

  it('parses Retry-After in seconds or as an HTTP date', () => {
    const now = Date.parse('2026-10-04T12:00:00Z')
    expect(parseRetryAfter('3', now)).toBe(3000)
    expect(parseRetryAfter('Sun, 04 Oct 2026 12:00:10 GMT', now)).toBe(10_000)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(undefined, now)).toBeNull()
  })
})

describe('per-minute rate limiter', () => {
  it('waits for a request slot once the per-minute request budget is used', async() => {
    const clock = new FakeClock()
    const limiter = new RateLimiter({ requestsPerMinute: 2, charsPerMinute: 1000 }, clock)
    await limiter.acquire(10)
    await limiter.acquire(10)
    expect(clock.sleeps).toEqual([])
    await limiter.acquire(10)
    // One request token refills in 60000 / 2 ms.
    expect(clock.sleeps).toEqual([30_000])
  })

  it('waits until enough characters refilled', async() => {
    const clock = new FakeClock()
    const limiter = new RateLimiter({ requestsPerMinute: 100, charsPerMinute: 100 }, clock)
    await limiter.acquire(80)
    await limiter.acquire(50)
    // 30 characters missing at 100 per minute.
    expect(clock.sleeps).toEqual([18_000])
  })

  it('serves callers in order and empties the budget after a 429', async() => {
    const clock = new FakeClock()
    const limiter = new RateLimiter({ requestsPerMinute: 60, charsPerMinute: 6000 }, clock)
    const order: number[] = []
    await Promise.all([1, 2, 3].map((n) => limiter.acquire(100).then(() => order.push(n))))
    expect(order).toEqual([1, 2, 3])
    limiter.drain()
    await limiter.acquire(100)
    // 100 characters at 6000 per minute take 1000 ms; one request token also takes 1000 ms.
    expect(clock.sleeps).toEqual([1000])
  })

  it('throttles the client between requests', async() => {
    const clock = new FakeClock()
    const { fetch } = scripted([respond(200, { matches: [] }), respond(200, { matches: [] }), respond(200, { matches: [] })])
    const client = new LanguageToolClient(fetch, { requestsPerMinute: 2, charsPerMinute: 100_000, maxCharsPerRequest: 1000 }, RETRY, clock)
    for (let i = 0; i < 3; i++) await client.check([BLOCK], OPTIONS)
    expect(clock.sleeps).toEqual([30_000])
  })
})
