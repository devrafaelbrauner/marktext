import { describe, expect, it, vi } from 'vitest'
import type {
  Disposable,
  MainPluginContext,
  PluginCallInfo,
  SafeFetchInit,
  SafeFetchResponse
} from '../../../../../src/main/plugins/types'
import type { PluginSettingValue } from '@shared/plugins/types'
import grammarMain from '@plugins/grammar/main'
import { manifest } from '@plugins/grammar/manifest'
import type { CheckResponse } from '@plugins/grammar/common/types'

const respond = (body: unknown, status = 200): SafeFetchResponse => {
  const text = JSON.stringify(body)
  return {
    status,
    ok: status === 200,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
    json: <T>() => JSON.parse(text) as T
  }
}

const createContext = (values: Record<string, PluginSettingValue>, apiKey: string | null) => {
  const handlers = new Map<string, (call: PluginCallInfo, ...args: unknown[]) => unknown>()
  const listeners: Array<(key: string, value: PluginSettingValue) => void> = []
  const settings: Record<string, PluginSettingValue> = {}
  for (const schema of manifest.settings ?? []) if (schema.type !== 'secret') settings[schema.key] = schema.default
  Object.assign(settings, values)
  const requests: Array<{ url: string; params: URLSearchParams }> = []
  const fetch = vi.fn(async(url: string, init?: SafeFetchInit): Promise<SafeFetchResponse> => {
    const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : url.split('?')[1] ?? '')
    requests.push({ url: url.split('?')[0], params })
    if (url.includes('/words?')) return respond({ words: ['remoto'] })
    if (url.endsWith('/words/add') || url.endsWith('/words/delete')) return respond({ added: true })
    return respond({ matches: [] })
  })
  const ctx: MainPluginContext = {
    id: 'grammar',
    manifest,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    handle: (method, handler) => {
      handlers.set(method, handler)
      return { dispose: () => handlers.delete(method) }
    },
    emit: vi.fn(),
    settings: {
      get: <T extends PluginSettingValue>(key: string) => settings[key] as T,
      onDidChange: (listener) => {
        listeners.push(listener)
        return { dispose: () => {} }
      }
    },
    secrets: { get: async() => apiKey, isSet: () => apiKey !== null },
    net: { fetch },
    track: <T extends Disposable>(d: T) => d
  }
  const call = { windowId: 1, webContentsId: 1 }
  return {
    ctx,
    fetch,
    requests,
    check: async(blocks: unknown): Promise<CheckResponse> => {
      const handler = handlers.get('check')
      if (!handler) throw new Error('check is not registered')
      return handler(call, blocks) as Promise<CheckResponse>
    },
    change: (key: string, value: PluginSettingValue) => {
      settings[key] = value
      for (const listener of listeners) listener(key, value)
    }
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const BLOCKS = [{ key: 'k', annotation: [{ text: 'Eu vai.' }] }]

describe('grammar main part', () => {
  it('never contacts the server before consent', async() => {
    const harness = createContext({ server: 'free', consentGiven: false }, null)
    await grammarMain.activate(harness.ctx)
    const response = await harness.check(BLOCKS)
    expect(response).toEqual({ results: [], error: { code: 'CONSENT', message: expect.any(String) } })
    await settle()
    expect(harness.fetch).not.toHaveBeenCalled()
  })

  it('requires Premium credentials and a valid custom URL', async() => {
    const premium = createContext({ server: 'premium', consentGiven: true, username: 'me@x.com' }, null)
    await grammarMain.activate(premium.ctx)
    expect((await premium.check(BLOCKS)).error?.code).toBe('CONFIG')

    const custom = createContext({ server: 'custom', consentGiven: true, serverUrl: 'ftp://x' }, null)
    await grammarMain.activate(custom.ctx)
    expect((await custom.check(BLOCKS)).error?.code).toBe('CONFIG')
    await settle()
    expect(premium.fetch).not.toHaveBeenCalled()
    expect(custom.fetch).not.toHaveBeenCalled()
  })

  it('checks against the selected server', async() => {
    const harness = createContext({ server: 'custom', consentGiven: true, serverUrl: 'http://localhost:8081/v2/' }, null)
    await grammarMain.activate(harness.ctx)
    expect(await harness.check(BLOCKS)).toEqual({ results: [{ key: 'k', matches: [] }] })
    expect(harness.requests.map((r) => r.url)).toEqual(['http://localhost:8081/v2/check'])
    expect(harness.requests[0].params.get('language')).toBe('pt-BR')
  })

  it('rejects malformed payloads', async() => {
    const harness = createContext({ server: 'free', consentGiven: true }, null)
    await grammarMain.activate(harness.ctx)
    await expect(harness.check([{ key: 1, annotation: [] }])).rejects.toThrow()
    await expect(harness.check([{ key: 'k', annotation: [{ html: '<b>' }] }])).rejects.toThrow()
    await expect(harness.check('nope')).rejects.toThrow()
  })

  it('syncs the personal dictionary with a Premium account', async() => {
    const harness = createContext(
      { server: 'premium', consentGiven: true, username: 'me@x.com', dictionary: ['remoto', 'Obsidian'] },
      'key'
    )
    await grammarMain.activate(harness.ctx)
    await vi.waitFor(() => expect(harness.requests.some((r) => r.url.endsWith('/words/add'))).toBe(true))
    // Only the word the account lacks is uploaded.
    const adds = () => harness.requests.filter((r) => r.url.endsWith('/words/add')).map((r) => r.params.get('word'))
    expect(adds()).toEqual(['Obsidian'])
    expect(harness.requests.find((r) => r.url.endsWith('/words/add'))?.params.get('apiKey')).toBe('key')

    harness.change('dictionary', ['Obsidian', 'MarkText'])
    await vi.waitFor(() => expect(harness.requests.some((r) => r.url.endsWith('/words/delete'))).toBe(true))
    expect(adds()).toEqual(['Obsidian', 'MarkText'])
    expect(harness.requests.filter((r) => r.url.endsWith('/words/delete')).map((r) => r.params.get('word'))).toEqual(['remoto'])
  })

  it('does not sync the dictionary without Premium credentials', async() => {
    const harness = createContext({ server: 'free', consentGiven: true, dictionary: ['Obsidian'] }, null)
    await grammarMain.activate(harness.ctx)
    harness.change('dictionary', ['Obsidian', 'MarkText'])
    await settle()
    await settle()
    expect(harness.fetch).not.toHaveBeenCalled()
  })
})
