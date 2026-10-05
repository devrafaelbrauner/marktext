import { describe, expect, it, vi } from 'vitest'
import type {
  Disposable,
  MainPluginContext,
  PluginCallInfo,
  SafeFetchInit,
  SafeFetchResponse
} from '../../../../../src/main/plugins/types'
import type { PluginSettingValue } from '@shared/plugins/types'
import aiMain from '@plugins/ai/main'
import { manifest } from '@plugins/ai/manifest'
import { cleanReply } from '@plugins/ai/main/prompts'
import type { CompleteResponse } from '@plugins/ai/common/types'

const respond = (content: string): SafeFetchResponse => {
  const text = JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })
  return {
    status: 200,
    ok: true,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
    json: <T>() => JSON.parse(text) as T
  }
}

const createContext = (values: Record<string, PluginSettingValue>, apiKey: string | null, reply = 'ok') => {
  const handlers = new Map<string, (call: PluginCallInfo, ...args: unknown[]) => unknown>()
  const settings: Record<string, PluginSettingValue> = {}
  for (const schema of manifest.settings ?? []) if (schema.type !== 'secret') settings[schema.key] = schema.default
  Object.assign(settings, values)
  const requests: Array<{ url: string; body: { model: string; messages: Array<{ role: string; content: string }> } }> = []
  const fetch = vi.fn(async(url: string, init?: SafeFetchInit): Promise<SafeFetchResponse> => {
    requests.push({ url, body: JSON.parse(init?.body as string) })
    return respond(reply)
  })
  const ctx: MainPluginContext = {
    id: 'ai',
    manifest,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    handle: (method, handler) => {
      handlers.set(method, handler)
      return { dispose: () => handlers.delete(method) }
    },
    emit: vi.fn(),
    settings: {
      get: <T extends PluginSettingValue>(key: string) => settings[key] as T,
      onDidChange: () => ({ dispose: () => {} })
    },
    secrets: { get: async() => apiKey, isSet: () => apiKey !== null },
    net: { fetch },
    track: <T extends Disposable>(d: T) => d
  }
  return {
    ctx,
    fetch,
    requests,
    complete: async(payload: unknown): Promise<CompleteResponse> => {
      if (!handlers.has('complete')) await aiMain.activate(ctx)
      const handler = handlers.get('complete')
      if (!handler) throw new Error('complete is not registered')
      return handler({ windowId: 1, webContentsId: 1 }, payload) as Promise<CompleteResponse>
    }
  }
}

const READY = { consentGiven: true, defaultModel: 'openai/gpt-4o-mini' }

describe('ai main part', () => {
  it('sends nothing before consent', async() => {
    const harness = createContext({ ...READY, consentGiven: false }, 'sk-or-1')
    const response = await harness.complete({ action: 'fixText', text: 'Eu vai' })
    expect(response).toEqual({ ok: false, error: { code: 'CONSENT', message: expect.any(String) } })
    expect(harness.fetch).not.toHaveBeenCalled()
  })

  it('needs an API key, a model and a valid base URL before sending', async() => {
    const noKey = createContext(READY, null)
    expect(await noKey.complete({ action: 'fixText', text: 'Eu vai' })).toMatchObject({ ok: false, error: { code: 'NO_KEY' } })

    const blankKey = createContext(READY, '  ')
    expect(await blankKey.complete({ action: 'fixText', text: 'Eu vai' })).toMatchObject({ ok: false, error: { code: 'NO_KEY' } })

    const noModel = createContext({ ...READY, defaultModel: ' ' }, 'sk-or-1')
    expect(await noModel.complete({ action: 'research', text: 'Why?' })).toMatchObject({ ok: false, error: { code: 'NO_MODEL' } })

    const badUrl = createContext({ ...READY, baseUrl: 'ftp://openrouter.ai' }, 'sk-or-1')
    expect(await badUrl.complete({ action: 'fixText', text: 'Eu vai' })).toMatchObject({ ok: false, error: { code: 'CONFIG' } })

    for (const harness of [noKey, blankKey, noModel, badUrl]) expect(harness.fetch).not.toHaveBeenCalled()
  })

  it('uses the action override before the default model, and only for that action', async() => {
    const harness = createContext({ ...READY, solveMathModel: ' deepseek/deepseek-r1 ' }, 'sk-or-1', '6')

    expect(await harness.complete({ action: 'solveMath', text: '2+2*2' })).toEqual({ ok: true, text: '6', model: 'deepseek/deepseek-r1' })
    expect(await harness.complete({ action: 'research', text: 'Capital of Brazil?' })).toMatchObject({ model: 'openai/gpt-4o-mini' })

    expect(harness.requests.map((r) => r.body.model)).toEqual(['deepseek/deepseek-r1', 'openai/gpt-4o-mini'])
    expect(harness.requests[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('sends the text verbatim after the action prompt, with the language hint', async() => {
    const harness = createContext(READY, 'sk-or-1', 'Eu vou na escola')
    await harness.complete({ action: 'fixText', text: 'Eu **vai** na escola', language: 'pt' })

    const [{ body }] = harness.requests
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(body.messages[0].content).toMatch(/never translate/)
    expect(body.messages[0].content).toContain('"pt"')
    expect(body.messages[1].content).toBe('Eu **vai** na escola')
  })

  it('unwraps a fenced reply for text and table actions only', async() => {
    const table = createContext(READY, 'sk-or-1', '```markdown\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```')
    expect(await table.complete({ action: 'createTable', text: 'a and b' })).toMatchObject({
      ok: true,
      text: '| a | b |\n| --- | --- |\n| 1 | 2 |'
    })

    const fixed = createContext(READY, 'sk-or-1', '```\nEu vou\n```\n')
    expect(await fixed.complete({ action: 'fixText', text: 'Eu vai' })).toMatchObject({ text: 'Eu vou' })

    const code = '```js\nconsole.log(1)\n```'
    const research = createContext(READY, 'sk-or-1', code)
    expect(await research.complete({ action: 'research', text: 'How do I log in JS?' })).toMatchObject({ text: code })

    expect(cleanReply('createTable', 'Here:\n```\n| a |\n```')).toBe('Here:\n```\n| a |\n```')
    expect(cleanReply('fixText', '~~~~text\nA ``` b\n~~~~')).toBe('A ``` b')
  })

  it('rewrites LaTeX math delimiters to muya dollars outside code, for math and research replies', () => {
    expect(cleanReply('solveMath', '1. \\( 0,15 \\times 240 = 36 \\)\n\n**45**')).toBe('1. $0,15 \\times 240 = 36$\n\n**45**')
    expect(cleanReply('research', 'Area:\n\\[ \\pi r^2 \\]\nDone')).toBe('Area:\n\n$$\n\\pi r^2\n$$\n\nDone')
    const code = 'Use `\\(x\\)` or:\n```tex\n\\(x\\)\n```'
    expect(cleanReply('research', code)).toBe(code)
    // Proofreading returns the user's text: their own LaTeX stays as written.
    expect(cleanReply('fixText', 'see \\(x\\)')).toBe('see \\(x\\)')
  })

  it('rejects malformed payloads', async() => {
    const harness = createContext(READY, 'sk-or-1')
    await expect(harness.complete({ action: 'translate', text: 'x' })).rejects.toThrow()
    await expect(harness.complete({ action: 'fixText', text: '   ' })).rejects.toThrow()
    await expect(harness.complete({ action: 'fixText', text: 'x'.repeat(20_001) })).rejects.toThrow()
    await expect(harness.complete({ action: 'fixText', text: 'x', language: 1 })).rejects.toThrow()
    await expect(harness.complete('nope')).rejects.toThrow()
    expect(harness.fetch).not.toHaveBeenCalled()
  })
})
