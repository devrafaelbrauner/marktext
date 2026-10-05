import { describe, expect, it } from 'vitest'
import type { SafeFetchInit, SafeFetchResponse } from '../../../../../src/main/plugins/types'
import { AiError, OpenRouterClient, parseCompletion, type CompletionOptions } from '@plugins/ai/main/client'
import type { RetryPolicy } from '@plugins/grammar/main/client'
import type { Clock } from '@plugins/grammar/main/limiter'

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

const completion = (content: unknown) => ({
  id: 'gen-1',
  model: 'openai/gpt-4o-mini',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }]
})

const OPTIONS: CompletionOptions = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test',
  model: 'openai/gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Fix it.' },
    { role: 'user', content: 'Eu vai na escola' }
  ]
}

const RETRY: RetryPolicy = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 5000 }

const setup = (replies: Array<SafeFetchResponse | Error>) => {
  const calls: Array<{ url: string; init?: SafeFetchInit }> = []
  const clock = new FakeClock()
  const fetch = async(url: string, init?: SafeFetchInit): Promise<SafeFetchResponse> => {
    calls.push({ url, init })
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    if (reply instanceof Error) throw reply
    return reply
  }
  return { client: new OpenRouterClient(fetch, RETRY, clock), calls, clock }
}

const transportError = (code: string): Error => Object.assign(new Error(`transport ${code}`), { code })

const failure = async(promise: Promise<unknown>): Promise<AiError> => {
  try {
    await promise
  } catch (err) {
    if (err instanceof AiError) return err
    throw err
  }
  throw new Error('expected a rejection')
}

describe('OpenRouterClient', () => {
  it('posts the model and messages as a chat completion with the key and app headers', async() => {
    const { client, calls } = setup([respond(200, completion('Eu vou na escola'))])

    expect(await client.complete(OPTIONS)).toBe('Eu vou na escola')

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect(init?.timeoutMs).toBe(60_000)
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk-or-test',
      'Content-Type': 'application/json',
      'HTTP-Referer': expect.stringMatching(/^https:\/\//),
      'X-Title': 'MarkText Plus'
    })
    expect(JSON.parse(init?.body as string)).toEqual({ model: OPTIONS.model, messages: OPTIONS.messages })
  })

  it('joins text parts of array content', () => {
    expect(parseCompletion(completion([{ type: 'text', text: 'a' }, { type: 'image_url' }, { type: 'text', text: 'b' }]))).toBe('ab')
  })

  it.each([
    [401, { error: { code: 401, message: 'No auth credentials found' } }, 'AUTH', 'No auth credentials found'],
    [402, { error: { code: 402, message: 'Insufficient credits' } }, 'CREDITS', 'Insufficient credits'],
    [403, { error: { code: 403, message: 'Input flagged by moderation' } }, 'FORBIDDEN', 'Input flagged by moderation'],
    [404, { error: { code: 404, message: 'No endpoints found for x/y.' } }, 'MODEL_NOT_FOUND', 'No endpoints found for x/y.'],
    [400, { error: { code: 400, message: 'x/y is not a valid model ID' } }, 'MODEL_NOT_FOUND', 'x/y is not a valid model ID'],
    [400, { error: { code: 400, message: 'messages must not be empty' } }, 'BAD_REQUEST', 'messages must not be empty'],
    [500, 'Internal error', 'SERVER', 'Internal error']
  ])('maps HTTP %i to an error without retrying', async(status, body, code, message) => {
    const { client, calls } = setup([respond(status, body)])
    const error = await failure(client.complete(OPTIONS))
    expect(error.toInfo()).toEqual({ code, message, status })
    expect(calls).toHaveLength(1)
  })

  it('waits for Retry-After on 429 and then succeeds', async() => {
    const { client, calls, clock } = setup([
      respond(429, { error: { code: 429, message: 'Rate limit exceeded' } }, { 'retry-after': '3' }),
      respond(200, completion('ok'))
    ])

    expect(await client.complete(OPTIONS)).toBe('ok')

    expect(calls).toHaveLength(2)
    expect(clock.sleeps[0]).toBe(3000)
  })

  it('gives up with RATE_LIMIT when Retry-After is longer than the policy allows', async() => {
    const { client, calls } = setup([respond(429, { error: { code: 429, message: 'Slow down' } }, { 'retry-after': '60' })])
    const error = await failure(client.complete(OPTIONS))
    expect(error.toInfo()).toEqual({ code: 'RATE_LIMIT', message: 'Slow down', status: 429, retryAfterMs: 60_000 })
    expect(calls).toHaveLength(1)
  })

  it('retries network failures with backoff but never a timeout', async() => {
    const network = setup([transportError('NETWORK'), transportError('NETWORK'), respond(200, completion('ok'))])
    expect(await network.client.complete(OPTIONS)).toBe('ok')
    expect(network.clock.sleeps).toEqual([100, 200])

    const timeout = setup([transportError('TIMEOUT')])
    expect((await failure(timeout.client.complete(OPTIONS))).code).toBe('TIMEOUT')
    expect(timeout.calls).toHaveLength(1)

    const badUrl = setup([transportError('BAD_URL')])
    expect((await failure(badUrl.client.complete(OPTIONS))).code).toBe('CONFIG')
  })

  it('rejects malformed, failed and empty completions', async() => {
    const malformed = setup([respond(200, '<html>gateway</html>')])
    expect((await failure(malformed.client.complete(OPTIONS))).code).toBe('SERVER')

    const notChat = setup([respond(200, { result: 'x' })])
    expect((await failure(notChat.client.complete(OPTIONS))).code).toBe('SERVER')

    // OpenRouter reports some provider failures inside a 200 body.
    const providerError = setup([respond(200, { error: { code: 402, message: 'Provider out of credits' } })])
    expect((await failure(providerError.client.complete(OPTIONS))).toInfo()).toEqual({
      code: 'CREDITS',
      message: 'Provider out of credits',
      status: 402
    })

    const empty = setup([respond(200, completion('   '))])
    expect((await failure(empty.client.complete(OPTIONS))).code).toBe('EMPTY')
  })
})
