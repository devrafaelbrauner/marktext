import type {
  CommunityPluginRecord,
  Disposable,
  PluginHostState,
  PluginManifest,
  PluginSettingValue
} from '@shared/plugins/types'
import { toPluginManifest } from '@shared/plugins/community'
import type { BuiltinMainPlugin } from './builtin'
import { PluginError } from './errors'
import { findSettingSchema, getSettingDefault, MAX_SETTING_STRING_LENGTH, validateSettingValue } from './settings'
import type { PluginStateStore } from './stateStore'
import type { MainPluginContext, MainPluginModule, PluginCallInfo } from './types'

/** The part of `SecretsStore` the host uses; plugin ids are the namespaces. */
export interface PluginSecrets {
  has(namespace: string, key: string): boolean
  get(namespace: string, key: string): Promise<string | null>
  set(namespace: string, key: string, value: string): Promise<void>
  delete(namespace: string, key: string): Promise<void>
}

export type PluginLogger = MainPluginContext['log']

export interface MainPluginHostOptions {
  /** Every built-in manifest (`@plugins/manifests`), including plugins without a main part. */
  manifests: readonly PluginManifest[]
  plugins: readonly BuiltinMainPlugin[]
  store: PluginStateStore
  secrets: PluginSecrets
  /** `--safe`: state is still served and editable, but nothing is activated. */
  safeMode: boolean
  fetch: MainPluginContext['net']['fetch']
  createLogger(scope: string): PluginLogger
  /** Pushes `mt::plugins::state-changed` to every app window. */
  publishState(state: PluginHostState): void
  /** Pushes `mt::plugins::event` to every app window, or only to `windowId`. */
  publishEvent(pluginId: string, event: string, payload: unknown, windowId?: number): void
  /** Installed community plugins. Absent in tests that only exercise built-ins. */
  community?: {
    records(): readonly CommunityPluginRecord[]
  }
}

type MethodHandler = (call: PluginCallInfo, ...args: unknown[]) => unknown
type SettingListener = (key: string, value: PluginSettingValue) => void

interface ActivePlugin {
  module: MainPluginModule
  methods: Map<string, MethodHandler>
  settingListeners: Set<SettingListener>
  /** Everything to dispose on deactivation, in registration order. */
  disposables: Disposable[]
}

/** Upper bound for one plugin's `deactivate()`, so a hung plugin cannot block quitting. */
export const DEACTIVATE_TIMEOUT_MS = 3000

const disposeAll = (disposables: Disposable[], log: PluginLogger): void => {
  for (const disposable of disposables.splice(0).reverse()) {
    try {
      disposable.dispose()
    } catch (err) {
      log.error('dispose failed:', err)
    }
  }
}

/**
 * Owns the main-process half of the plugin system: enabled flags, settings
 * and secrets of every built-in plugin, and the lifecycle of their main parts.
 * Main parts activate in `start()` (after app ready) and whenever a plugin is
 * enabled; they deactivate when disabled and in `stop()` (quit). State
 * changes are pushed to every window through `publishState`.
 */
export class MainPluginHost {
  private readonly active = new Map<string, ActivePlugin>()
  /** Tail of each plugin's activate/deactivate chain; transitions of one plugin never overlap. */
  private readonly transitions = new Map<string, Promise<void>>()
  private readonly log: PluginLogger
  private started = false
  private resolveStarted!: () => void
  private readonly startedPromise = new Promise<void>((resolve) => {
    this.resolveStarted = resolve
  })

  constructor(private readonly options: MainPluginHostOptions) {
    this.log = options.createLogger('plugins')
  }

  get safeMode(): boolean {
    return this.options.safeMode
  }

  getState(): PluginHostState {
    const { manifests, store, secrets, safeMode } = this.options
    const community: CommunityPluginRecord[] = []
    const state: PluginHostState = { safeMode, enabled: {}, settings: {}, secretsSet: {}, community }
    for (const manifest of manifests) {
      state.enabled[manifest.id] = store.isEnabled(manifest)
      state.settings[manifest.id] = { ...store.getSettings(manifest.id) }
      const secretKeys = (manifest.settings ?? []).filter((s) => s.type === 'secret')
      state.secretsSet[manifest.id] = Object.fromEntries(
        secretKeys.map((s) => [s.key, secrets.has(manifest.id, s.key)])
      )
    }
    const builtinIds = new Set(manifests.map((manifest) => manifest.id))
    for (const record of this.options.community?.records() ?? []) {
      if (builtinIds.has(record.id)) continue
      const manifest = toPluginManifest(record)
      community.push(record)
      state.enabled[record.id] = store.isEnabled(manifest)
      state.settings[record.id] = { ...store.getSettings(record.id) }
      const secretKeys = (manifest.settings ?? []).filter((s) => s.type === 'secret')
      state.secretsSet[record.id] = Object.fromEntries(
        secretKeys.map((s) => [s.key, secrets.has(record.id, s.key)])
      )
    }
    return state
  }

  /** Pushes the current state. Install and uninstall call this after the registry changes. */
  publish(): void {
    this.options.publishState(this.getState())
  }

  isActive(id: string): boolean {
    return this.active.has(id)
  }

  hasActivePlugins(): boolean {
    return this.active.size > 0
  }

  /** Activates the main part of every enabled plugin; a failing plugin is logged and skipped. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    if (!this.options.safeMode) {
      await Promise.all(
        this.options.plugins
          .filter((plugin) => this.isEnabledId(plugin.manifest.id))
          .map((plugin) => this.enqueue(plugin.manifest.id, () => this.activate(plugin)))
      )
    }
    this.resolveStarted()
  }

  /** Deactivates every active main part (quit). */
  async stop(): Promise<void> {
    await Promise.all(
      [...this.active.keys()].map((id) => this.enqueue(id, () => this.deactivate(id)))
    )
  }

  async setEnabled(id: unknown, enabled: unknown): Promise<void> {
    const manifest = this.requireManifest(id)
    if (typeof enabled !== 'boolean') throw new PluginError('FAILED', 'enabled must be a boolean')
    this.options.store.setEnabled(manifest.id, enabled)
    this.options.publishState(this.getState())
    if (this.options.safeMode || !this.started) return
    const plugin = this.options.plugins.find((p) => p.manifest.id === manifest.id)
    if (!plugin) return
    await this.enqueue(manifest.id, () => (enabled ? this.activate(plugin) : this.deactivate(manifest.id)))
  }

  setSetting(id: unknown, key: unknown, value: unknown): void {
    const manifest = this.requireManifest(id)
    const schema = typeof key === 'string' ? findSettingSchema(manifest, key) : undefined
    if (!schema || schema.type === 'secret') {
      throw new PluginError('FAILED', `Unknown setting "${String(key)}" of plugin "${manifest.id}"`)
    }
    const checked = validateSettingValue(schema, value)
    if (!checked.ok) throw new PluginError('FAILED', checked.message)
    this.options.store.setSetting(manifest.id, schema.key, checked.value)
    const listeners = this.active.get(manifest.id)?.settingListeners ?? []
    for (const listener of listeners) {
      try {
        listener(schema.key, checked.value)
      } catch (err) {
        this.log.error(`[${manifest.id}] settings listener failed:`, err)
      }
    }
    this.options.publishState(this.getState())
  }

  /** Stores (string) or clears (null or '') a `secret` setting. */
  async setSecret(id: unknown, key: unknown, value: unknown): Promise<void> {
    const manifest = this.requireManifest(id)
    const schema = typeof key === 'string' ? findSettingSchema(manifest, key) : undefined
    if (!schema || schema.type !== 'secret') {
      throw new PluginError('FAILED', `Unknown secret "${String(key)}" of plugin "${manifest.id}"`)
    }
    if (value === null || value === '') {
      await this.options.secrets.delete(manifest.id, schema.key)
    } else if (typeof value === 'string' && value.length <= MAX_SETTING_STRING_LENGTH) {
      await this.options.secrets.set(manifest.id, schema.key, value)
    } else {
      throw new PluginError('FAILED', `"${schema.key}" must be a string`)
    }
    this.options.publishState(this.getState())
  }

  /**
   * Calls `method` of the plugin's main part. Waits for the initial activation
   * pass and any pending enable/disable of that plugin first, so a renderer
   * part activated early does not see a spurious 'DISABLED'.
   */
  async invoke(id: unknown, method: unknown, args: unknown, call: PluginCallInfo): Promise<unknown> {
    const manifest = this.requireManifest(id)
    if (typeof method !== 'string' || !Array.isArray(args)) {
      throw new PluginError('FAILED', 'Malformed plugin call')
    }
    if (this.options.safeMode || !this.isEnabledId(manifest.id)) {
      throw new PluginError('DISABLED', `Plugin "${manifest.id}" is disabled`)
    }
    await this.startedPromise
    await this.transitions.get(manifest.id)
    const active = this.active.get(manifest.id)
    const handler = active?.methods.get(method)
    if (!active || !handler) {
      if (!this.isEnabledId(manifest.id)) {
        throw new PluginError('DISABLED', `Plugin "${manifest.id}" is disabled`)
      }
      throw new PluginError('UNKNOWN_METHOD', `Plugin "${manifest.id}" has no method "${method}"`)
    }
    try {
      return await handler(call, ...args)
    } catch (err) {
      throw new PluginError('FAILED', err instanceof Error ? err.message : String(err))
    }
  }

  private findManifest(id: string): PluginManifest | undefined {
    const builtin = this.options.manifests.find((manifest) => manifest.id === id)
    if (builtin) return builtin
    const record = this.options.community?.records().find((item) => item.id === id)
    return record ? toPluginManifest(record) : undefined
  }

  private isEnabledId(id: string): boolean {
    const manifest = this.findManifest(id)
    return !!manifest && this.options.store.isEnabled(manifest)
  }

  private requireManifest(id: unknown): PluginManifest {
    const manifest = typeof id === 'string' ? this.findManifest(id) : undefined
    if (!manifest) throw new PluginError('FAILED', `Unknown plugin "${String(id)}"`)
    return manifest
  }

  private enqueue(id: string, transition: () => Promise<void>): Promise<void> {
    const next = (this.transitions.get(id) ?? Promise.resolve()).then(transition, transition)
    this.transitions.set(id, next)
    return next
  }

  private async activate(plugin: BuiltinMainPlugin): Promise<void> {
    const { id } = plugin.manifest
    if (this.active.has(id) || !this.isEnabledId(id)) return
    const log = this.options.createLogger(`plugin:${id}`)
    const record: ActivePlugin = {
      module: { activate: () => {} },
      methods: new Map(),
      settingListeners: new Set(),
      disposables: []
    }
    try {
      record.module = await plugin.load()
      this.active.set(id, record)
      await record.module.activate(this.createContext(plugin.manifest, record, log))
    } catch (err) {
      log.error('activation failed:', err)
      this.active.delete(id)
      disposeAll(record.disposables, log)
    }
  }

  private async deactivate(id: string): Promise<void> {
    const record = this.active.get(id)
    if (!record) return
    this.active.delete(id)
    const log = this.options.createLogger(`plugin:${id}`)
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.resolve().then(() => record.module.deactivate?.()),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('deactivate timed out')), DEACTIVATE_TIMEOUT_MS)
        })
      ])
    } catch (err) {
      log.error('deactivation failed:', err)
    } finally {
      clearTimeout(timer)
      disposeAll(record.disposables, log)
    }
  }

  private createContext(manifest: PluginManifest, record: ActivePlugin, log: PluginLogger): MainPluginContext {
    const { id } = manifest
    const track = <T extends Disposable>(disposable: T): T => {
      record.disposables.push(disposable)
      return disposable
    }
    const requireSchema = (key: string, secret: boolean) => {
      const schema = findSettingSchema(manifest, key)
      if (!schema || (schema.type === 'secret') !== secret) {
        throw new Error(`Plugin "${id}" declares no ${secret ? 'secret' : 'setting'} "${key}"`)
      }
      return schema
    }
    return {
      id,
      manifest,
      log,
      handle: (method, handler) => {
        if (record.methods.has(method)) throw new Error(`Method "${method}" is already registered`)
        record.methods.set(method, handler)
        return track({
          dispose: () => {
            if (record.methods.get(method) === handler) record.methods.delete(method)
          }
        })
      },
      emit: (event, payload, windowId) => {
        if (this.active.get(id) === record) this.options.publishEvent(id, event, payload, windowId)
      },
      settings: {
        get: <T extends PluginSettingValue>(key: string): T => {
          const schema = requireSchema(key, false)
          return (this.options.store.getSettings(id)[key] ?? getSettingDefault(schema)) as T
        },
        onDidChange: (listener) => {
          record.settingListeners.add(listener)
          return track({ dispose: () => record.settingListeners.delete(listener) })
        }
      },
      secrets: {
        get: (key) => {
          requireSchema(key, true)
          return this.options.secrets.get(id, key)
        },
        isSet: (key) => {
          requireSchema(key, true)
          return this.options.secrets.has(id, key)
        }
      },
      net: { fetch: (url, init) => this.options.fetch(url, init) },
      track
    }
  }
}
