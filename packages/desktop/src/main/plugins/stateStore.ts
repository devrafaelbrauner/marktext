import type { PluginManifest, PluginSettingValue } from '@shared/plugins/types'
import { sanitizeStoredSettings } from './settings'

/** Shape of `plugins.json`. Plugin ids missing from `enabled` use the manifest's `defaultEnabled`. */
export interface PersistedPluginState {
  enabled: Record<string, boolean>
  settings: Record<string, Record<string, PluginSettingValue>>
}

/** Storage behind `PluginStateStore`; electron-store in the app, an object in tests. */
export interface PluginStateBacking {
  read(): unknown
  write(state: PersistedPluginState): void
}

type ObjectEntries = Array<[string, unknown]>

/** Own entries of a plain object, or none for anything else (corrupted file, wrong type). */
const entriesOf = (value: unknown): ObjectEntries =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : []

/**
 * Enabled flags and non-secret settings of the built-in plugins. Entries of
 * unknown plugins are kept untouched (a plugin may come back in a later
 * version); entries of known plugins are re-validated against the manifest
 * when loaded.
 */
export class PluginStateStore {
  private readonly state: PersistedPluginState

  constructor(
    private readonly manifests: readonly PluginManifest[],
    private readonly backing: PluginStateBacking
  ) {
    this.state = this.load()
  }

  private load(): PersistedPluginState {
    const raw = this.backing.read() as { enabled?: unknown; settings?: unknown } | null | undefined
    const state: PersistedPluginState = { enabled: {}, settings: {} }
    for (const [id, flag] of entriesOf(raw?.enabled)) {
      if (typeof flag === 'boolean') state.enabled[id] = flag
    }
    for (const [id, values] of entriesOf(raw?.settings)) {
      const manifest = this.manifests.find((m) => m.id === id)
      if (manifest) {
        state.settings[id] = sanitizeStoredSettings(manifest, values)
      } else if (entriesOf(values).length > 0) {
        state.settings[id] = values as Record<string, PluginSettingValue>
      }
    }
    return state
  }

  isEnabled(manifest: PluginManifest): boolean {
    return this.state.enabled[manifest.id] ?? manifest.defaultEnabled
  }

  setEnabled(id: string, enabled: boolean): void {
    this.state.enabled[id] = enabled
    this.backing.write(this.state)
  }

  /** Stored values of one plugin (no defaults). */
  getSettings(id: string): Record<string, PluginSettingValue> {
    return this.state.settings[id] ?? {}
  }

  setSetting(id: string, key: string, value: PluginSettingValue): void {
    this.state.settings[id] = { ...this.getSettings(id), [key]: value }
    this.backing.write(this.state)
  }
}
