import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeFetch } from '../../../../../src/main/security/safeFetch'
import { OpenRouterClient } from '@plugins/ai/main/client'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

interface Received {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: unknown
}

let server: Server | null = null

afterEach(async() => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

/** Local OpenRouter stand-in answering every request with `reply`; returns its base URL and what it received. */
const startStub = async(reply: { status: number; body: unknown }) => {
  const received: Received[] = []
  const stub = createServer((req, res) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
    })
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: JSON.parse(data) })
      res.writeHead(reply.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply.body))
    })
  })
  server = stub
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const { port } = stub.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}/api/v1`, received }
}

const client = () => new OpenRouterClient((url, init) => safeFetch(url, init, (u, i) => fetch(u, i)))

describe('OpenRouterClient over safeFetch', () => {
  it('round-trips a chat completion through a real HTTP exchange', async() => {
    const stub = await startStub({
      status: 200,
      body: { choices: [{ message: { role: 'assistant', content: 'Eu vou na escola' } }] }
    })

    const text = await client().complete({
      baseUrl: stub.baseUrl,
      apiKey: 'sk-or-local',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'Eu vai na escola' }]
    })

    expect(text).toBe('Eu vou na escola')
    expect(stub.received).toHaveLength(1)
    const [request] = stub.received
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/api/v1/chat/completions')
    expect(request.headers.authorization).toBe('Bearer sk-or-local')
    expect(request.headers['content-type']).toBe('application/json')
    expect(request.headers['x-title']).toBe('MarkText Plus')
    expect(request.body).toEqual({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'Eu vai na escola' }] })
  })

  it('reads the error message of a real error reply', async() => {
    const stub = await startStub({ status: 401, body: { error: { code: 401, message: 'User not found.' } } })
    await expect(
      client().complete({ baseUrl: stub.baseUrl, apiKey: 'bad', model: 'x/y', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'AUTH', status: 401, message: 'User not found.' })
  })
})
