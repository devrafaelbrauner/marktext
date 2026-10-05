// Plugin secrets (`secret` settings such as API keys) on Android: values are
// encrypted by the native MtSecrets plugin with an Android Keystore key and
// never reach the renderer. The desktop host asks `has()` synchronously while
// building its state, so the set of stored keys (never the values) is cached
// here and kept in step with every write.

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginSecrets } from '../../../../desktop/src/main/plugins/host'

/** Storage behind `CachedPluginSecrets`: the Keystore plugin, or memory in the browser build. */
export interface SecretsBackend {
  /** Stored keys per namespace; values are not returned. */
  list(): Promise<Record<string, string[]>>
  get(namespace: string, key: string): Promise<string | null>
  set(namespace: string, key: string, value: string): Promise<void>
  delete(namespace: string, key: string): Promise<void>
}

interface MtSecretsPlugin {
  list(): Promise<{ namespaces: Record<string, string[]> }>
  get(options: { namespace: string; key: string }): Promise<{ value: string | null }>
  set(options: { namespace: string; key: string; value: string }): Promise<void>
  delete(options: { namespace: string; key: string }): Promise<void>
}

const keystoreBackend = (): SecretsBackend => {
  const native = registerPlugin<MtSecretsPlugin>('MtSecrets')
  return {
    list: async() => (await native.list()).namespaces,
    get: async(namespace, key) => (await native.get({ namespace, key })).value,
    set: (namespace, key, value) => native.set({ namespace, key, value }),
    delete: (namespace, key) => native.delete({ namespace, key })
  }
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
  CachedPluginSecrets.load(Capacitor.isNativePlatform() ? keystoreBackend() : memorySecretsBackend())
