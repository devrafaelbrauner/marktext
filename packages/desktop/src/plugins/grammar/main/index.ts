import type { MainPluginContext, MainPluginModule } from '../../../main/plugins/types'
import { isGrammarServer, PLAN_LIMITS, resolveBaseUrl } from '../common/plans'
import type { AnnotationPart, CheckBlockInput, CheckResponse, GrammarServer } from '../common/types'
import { GrammarError, LanguageToolClient, type CheckOptions } from './client'

/** Upper bounds for one `check` call from the renderer, which batches far below them. */
const MAX_BLOCKS_PER_CALL = 5000
const MAX_CHARS_PER_CALL = 1_000_000
const MAX_DICTIONARY_WORDS = 500

const isAnnotationPart = (value: unknown): value is AnnotationPart => {
  if (value === null || typeof value !== 'object') return false
  const part = value as Record<string, unknown>
  if (typeof part.text === 'string') return part.markup === undefined
  return typeof part.markup === 'string' && (part.interpretAs === undefined || typeof part.interpretAs === 'string')
}

/** Validates the renderer's `check` payload; throws on anything malformed. */
const parseBlocks = (payload: unknown): CheckBlockInput[] => {
  if (!Array.isArray(payload) || payload.length > MAX_BLOCKS_PER_CALL) throw new Error('Invalid blocks')
  let total = 0
  return payload.map((item: unknown) => {
    const block = (item ?? {}) as Record<string, unknown>
    if (typeof block.key !== 'string' || !Array.isArray(block.annotation) || !block.annotation.every(isAnnotationPart)) {
      throw new Error('Invalid block')
    }
    const annotation = block.annotation as AnnotationPart[]
    for (const part of annotation) total += 'text' in part ? part.text.length : part.markup.length
    if (total > MAX_CHARS_PER_CALL) throw new Error('Too much text in one call')
    return { key: block.key, annotation }
  })
}

interface ResolvedConfig {
  server: GrammarServer
  options: CheckOptions
}

type AccountOptions = CheckOptions & { credentials: NonNullable<CheckOptions['credentials']> }

const grammarMain: MainPluginModule = {
  activate(ctx: MainPluginContext) {
    const clients = new Map<GrammarServer, LanguageToolClient>()
    const clientFor = (server: GrammarServer): LanguageToolClient => {
      let client = clients.get(server)
      if (!client) {
        client = new LanguageToolClient((url, init) => ctx.net.fetch(url, init), PLAN_LIMITS[server])
        clients.set(server, client)
      }
      return client
    }

    const readConfig = async(): Promise<ResolvedConfig> => {
      const rawServer = ctx.settings.get<string>('server')
      const server: GrammarServer = isGrammarServer(rawServer) ? rawServer : 'premium'
      const baseUrl = resolveBaseUrl(server, ctx.settings.get<string>('serverUrl'))
      if (!baseUrl) throw new GrammarError('CONFIG', 'The custom LanguageTool server URL is missing or invalid')
      const username = ctx.settings.get<string>('username').trim()
      const apiKey = (await ctx.secrets.get('apiKey'))?.trim() ?? ''
      const credentials = username && apiKey ? { username, apiKey } : null
      if (server === 'premium' && !credentials) {
        throw new GrammarError('CONFIG', 'LanguageTool Premium needs a username and an API key')
      }
      return {
        server,
        options: {
          baseUrl,
          language: ctx.settings.get<string>('language'),
          level: ctx.settings.get<string>('level'),
          motherTongue: ctx.settings.get<string>('motherTongue'),
          credentials
        }
      }
    }

    // Dictionary sync runs one operation at a time; failures are logged and retried on the next sync.
    let syncQueue: Promise<void> = Promise.resolve()
    let syncedAccount: string | null = null
    let lastDictionary = [...ctx.settings.get<string[]>('dictionary')]

    const enqueueSync = (task: (client: LanguageToolClient, options: AccountOptions) => Promise<void>): void => {
      syncQueue = syncQueue
        .then(async() => {
          const { server, options } = await readConfig()
          const { credentials } = options
          if (server !== 'premium' || !credentials) return
          await task(clientFor(server), { ...options, credentials })
        })
        .catch((err: unknown) => {
          // Missing credentials only means there is no account to sync with.
          if (err instanceof GrammarError && err.code === 'CONFIG') return
          ctx.log.warn('Dictionary sync failed:', err instanceof Error ? err.message : String(err))
        })
    }

    /** Uploads local words the account does not have yet; never deletes remote words added elsewhere. */
    const syncAccount = (): void => {
      enqueueSync(async(client, options) => {
        const account = `${options.baseUrl}|${options.credentials.username}`
        if (syncedAccount === account) return
        const remote = new Set(await client.listWords(options))
        const local = ctx.settings.get<string[]>('dictionary').slice(0, MAX_DICTIONARY_WORDS)
        for (const word of local) {
          if (!remote.has(word)) await client.updateWord('add', word, options)
        }
        syncedAccount = account
      })
    }

    ctx.track(
      ctx.settings.onDidChange((key, value) => {
        if (key === 'dictionary' && Array.isArray(value)) {
          const next = value.filter((w): w is string => typeof w === 'string')
          const added = next.filter((w) => !lastDictionary.includes(w))
          const removed = lastDictionary.filter((w) => !next.includes(w))
          lastDictionary = next
          if (added.length === 0 && removed.length === 0) return
          enqueueSync(async(client, options) => {
            for (const word of added) await client.updateWord('add', word, options)
            for (const word of removed) await client.updateWord('delete', word, options)
          })
        } else if (key === 'server' || key === 'username') {
          syncedAccount = null
          syncAccount()
        }
      })
    )

    ctx.handle('check', async(_call, payload): Promise<CheckResponse> => {
      if (!ctx.settings.get<boolean>('consentGiven')) {
        return { results: [], error: { code: 'CONSENT', message: 'Consent required before sending text' } }
      }
      const blocks = parseBlocks(payload)
      let config: ResolvedConfig
      try {
        config = await readConfig()
      } catch (err) {
        if (err instanceof GrammarError) return { results: [], error: err.toInfo() }
        throw err
      }
      if (config.server === 'premium') syncAccount()
      return clientFor(config.server).check(blocks, config.options)
    })

    syncAccount()
  }
}

export default grammarMain
