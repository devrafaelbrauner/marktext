// Plugin secrets (`secret` settings such as API keys) on Android: values are
// encrypted by the native MtSecretsPlugin with an Android Keystore key and
// never reach the renderer. The desktop host asks `has()` synchronously while
// building its state, so the set of stored keys (never the values) is cached
// here and kept in step with every write.
//
// Values cross to Java over the `window.mtSecrets` message channel rather
// than as Capacitor plugin calls, which debug builds log to Logcat with their
// arguments and results.

import { Capacitor } from '@capacitor/core'
import type { PluginSecrets } from '../../../../desktop/src/main/plugins/host'

/** Storage behind `CachedPluginSecrets`: the Keystore channel, or memory in the browser build. */
export interface SecretsBackend {
  /** Stored keys per namespace; values are not returned. */
  list(): Promise<Record<string, string[]>>
  get(namespace: string, key: string): Promise<string | null>
  set(namespace: string, key: string, value: string): Promise<void>
  delete(namespace: string, key: string): Promise<void>
}

/** The object `WebViewCompat.addWebMessageListener` injects into the top document. */
export interface SecretsChannel {
  postMessage(message: string): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

interface ChannelReply {
  id: number
  ok: boolean
  error?: string
  value?: string | null
  namespaces?: Record<string, string[]>
}

/** Backend over the native channel: one JSON request per call, matched to its reply by id. */
export const channelSecretsBackend = (channel: SecretsChannel): SecretsBackend => {
  let nextId = 1
  const pending = new Map<number, { resolve: (reply: ChannelReply) => void; reject: (error: Error) => void }>()
  channel.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    const reply = JSON.parse(event.data) as ChannelReply
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id)
    if (reply.ok) waiter.resolve(reply)
    else waiter.reject(new Error(reply.error ?? 'Secret storage failed'))
  })
  const request = (op: string, fields: Record<string, string> = {}): Promise<ChannelReply> => {
    const id = nextId++
    // Executor form: Promise.withResolvers is ES2024, past this build's lib and older WebViews.
    const reply = new Promise<ChannelReply>((resolve, reject) => pending.set(id, { resolve, reject }))
    channel.postMessage(JSON.stringify({ id, op, ...fields }))
    return reply
  }
  return {
    list: async() => (await request('list')).namespaces ?? {},
    get: async(namespace, key) => (await request('get', { namespace, key })).value ?? null,
    set: async(namespace, key, value) => {
      await request('set', { namespace, key, value })
    },
    delete: async(namespace, key) => {
      await request('delete', { namespace, key })
    }
  }
}

const nativeBackend = (): SecretsBackend => {
  const channel = (window as Window & { mtSecrets?: SecretsChannel }).mtSecrets
  if (!channel) {
    // MtSecretsPlugin needs a WebView with WEB_MESSAGE_LISTENER; without it no secret can be kept.
    const unavailable = (): Promise<never> => Promise.reject(new Error('Secure storage is unavailable on this device'))
    return { list: async() => ({}), get: unavailable, set: unavailable, delete: unavailable }
  }
  return channelSecretsBackend(channel)
}

/** Unencrypted, process-lifetime secrets for the browser dev build and tests. */
export const memorySecretsBackend = (): SecretsBackend => {
  const values = new Map<string, Map<string, string>>()
  return {
    list: async() => Object.fromEntries([...values].map(([namespace, keys]) => [namespace, [...keys.keys()]])),
    get: async(namespace, key) => values.get(namespace)?.get(key) ?? null,
    set: async(namespace, key, value) => {
      let keys = values.get(namespace)
      if (!keys) values.set(namespace, (keys = new Map()))
      keys.set(key, value)
    },
    delete: async(namespace, key) => {
      values.get(namespace)?.delete(key)
    }
  }
}

/** `PluginSecrets` over a backend, answering `has()` from the cached key set. */
export class CachedPluginSecrets implements PluginSecrets {
  private constructor(
    private readonly backend: SecretsBackend,
    private readonly present: Map<string, Set<string>>
  ) {}

  static async load(backend: SecretsBackend): Promise<CachedPluginSecrets> {
    const listed = await backend.list()
    const present = new Map<string, Set<string>>()
    for (const [namespace, keys] of Object.entries(listed)) present.set(namespace, new Set(keys))
    return new CachedPluginSecrets(backend, present)
  }

  has(namespace: string, key: string): boolean {
    return this.present.get(namespace)?.has(key) ?? false
  }

  get(namespace: string, key: string): Promise<string | null> {
    return this.backend.get(namespace, key)
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    await this.backend.set(namespace, key, value)
    let keys = this.present.get(namespace)
    if (!keys) this.present.set(namespace, (keys = new Set()))
    keys.add(key)
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.backend.delete(namespace, key)
    this.present.get(namespace)?.delete(key)
  }
}

export const createPluginSecrets = (): Promise<CachedPluginSecrets> =>
  CachedPluginSecrets.load(Capacitor.isNativePlatform() ? nativeBackend() : memorySecretsBackend())
