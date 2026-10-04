import { shallowRef, type ShallowRef } from 'vue'
import type {
  Disposable,
  PluginHostState,
  PluginManifest,
  PluginSettingValue
} from '@shared/plugins/types'
import { unwrapIpcResult } from './errors'

export type PluginsBridge = Pick<
  PluginsAPI,
  'getState' | 'setEnabled' | 'setSetting' | 'setSecret' | 'onStateChanged'
>

type StateListener = (state: PluginHostState, previous: PluginHostState | null) => void

/** Stored value of a setting, or its schema default; undefined for secrets and unknown keys. */
export const resolveSetting = (
  state: PluginHostState | null,
  manifest: PluginManifest,
  key: string
): PluginSettingValue | undefined => {
  const schema = manifest.settings?.find((s) => s.key === key)
  if (!schema || schema.type === 'secret') return undefined
  const stored = state?.settings[manifest.id]?.[key]
  if (stored !== undefined) return stored
  return Array.isArray(schema.default) ? [...schema.default] : schema.default
}

/**
 * Renderer mirror of the main process `PluginHostState`: loaded once, then
 * replaced on every `mt::plugins::state-changed` push. Writes go to main,
 * which validates them and pushes the new state to every window (this one
 * included), so `state` only ever holds what main accepted.
 */
export class PluginStateClient {
  readonly state: ShallowRef<PluginHostState | null> = shallowRef(null)
  private readonly listeners = new Set<StateListener>()
  private unsubscribe: (() => void) | null = null
  private loading: Promise<PluginHostState> | null = null

  constructor(private readonly bridge: PluginsBridge) {}

  /** Fetches the state and starts following pushes; later calls return the first load. */
  load(): Promise<PluginHostState> {
    if (!this.loading) {
      this.unsubscribe = this.bridge.onStateChanged((state) => this.apply(state))
      this.loading = this.bridge.getState().then((state) => {
        // A push that arrived while the request was in flight is newer.
        if (!this.state.value) this.apply(state)
        return this.state.value!
      })
    }
    return this.loading
  }

  onDidChange(listener: StateListener): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  isEnabled(id: string): boolean {
    return !!this.state.value?.enabled[id]
  }

  isSecretSet(id: string, key: string): boolean {
    return !!this.state.value?.secretsSet[id]?.[key]
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    unwrapIpcResult(await this.bridge.setEnabled(id, enabled))
  }

  async setSetting(id: string, key: string, value: PluginSettingValue): Promise<void> {
    // Vue proxies cannot cross the context bridge.
    const plain = Array.isArray(value) ? [...value] : value
    unwrapIpcResult(await this.bridge.setSetting(id, key, plain))
  }

  async setSecret(id: string, key: string, value: string | null): Promise<void> {
    unwrapIpcResult(await this.bridge.setSecret(id, key, value))
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
  }

  private apply(state: PluginHostState): void {
    const previous = this.state.value
    this.state.value = state
    for (const listener of [...this.listeners]) {
      try {
        listener(state, previous)
      } catch (err) {
        console.error('[plugins] state listener failed:', err)
      }
    }
  }
}
