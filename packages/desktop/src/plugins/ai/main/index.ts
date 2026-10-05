import type { MainPluginContext, MainPluginModule } from '../../../main/plugins/types'
import { resolveBaseUrl, resolveModel } from '../common/config'
import { isAiAction, MAX_INPUT_CHARS, type CompleteRequest, type CompleteResponse } from '../common/types'
import { AiError, OpenRouterClient } from './client'
import { buildMessages, cleanReply } from './prompts'

/** Validates the renderer's `complete` payload; throws on anything malformed. */
const parseRequest = (payload: unknown): CompleteRequest => {
  const request = (payload ?? {}) as Record<string, unknown>
  const { action, text, language } = request
  if (!isAiAction(action)) throw new Error('Invalid action')
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_INPUT_CHARS) throw new Error('Invalid text')
  if (language !== undefined && typeof language !== 'string') throw new Error('Invalid language')
  return { action, text, language }
}

const aiMain: MainPluginModule = {
  activate(ctx: MainPluginContext) {
    const client = new OpenRouterClient((url, init) => ctx.net.fetch(url, init))

    // Checks run cheapest-first and all of them before any network access:
    // nothing leaves the machine without consent, a key, a model and a valid URL.
    ctx.handle('complete', async(_call, payload): Promise<CompleteResponse> => {
      const request = parseRequest(payload)
      if (!ctx.settings.get<boolean>('consentGiven')) {
        return { ok: false, error: { code: 'CONSENT', message: 'Consent required before sending text' } }
      }
      const apiKey = (await ctx.secrets.get('apiKey'))?.trim() ?? ''
      if (!apiKey) return { ok: false, error: { code: 'NO_KEY', message: 'The OpenRouter API key is not set' } }
      const model = resolveModel((key) => ctx.settings.get<string>(key), request.action)
      if (!model) return { ok: false, error: { code: 'NO_MODEL', message: 'No model is set for this command' } }
      const baseUrl = resolveBaseUrl(ctx.settings.get<string>('baseUrl'))
      if (!baseUrl) return { ok: false, error: { code: 'CONFIG', message: 'The API base URL is invalid' } }

      try {
        const reply = await client.complete({
          baseUrl,
          apiKey,
          model,
          messages: buildMessages(request.action, request.text, request.language)
        })
        const text = cleanReply(request.action, reply)
        if (!text) return { ok: false, error: { code: 'EMPTY', message: 'The model returned no text' } }
        return { ok: true, text, model }
      } catch (err) {
        if (err instanceof AiError) return { ok: false, error: err.toInfo() }
        throw err
      }
    })
  }
}

export default aiMain
