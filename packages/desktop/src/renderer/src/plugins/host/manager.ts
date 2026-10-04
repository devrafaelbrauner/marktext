import type { Disposable, PluginHostState } from '@shared/plugins/types'
import type { RendererPluginModule } from '../types'
import type { PluginContextHandle, PluginDescriptor } from './context'
import type { PluginStateClient } from './pluginState'

/** Renderer entry of a built-in plugin (see `@/plugins/builtin`). */
export interface RendererPluginEntry extends PluginDescriptor {
  load(): Promise<RendererPluginModule>
}

export interface PluginManagerOptions {
  plugins: readonly RendererPluginEntry[]
  stateClient: PluginStateClient
  createContext(plugin: RendererPluginEntry): PluginContextHandle
  /** Re-renders the active document after a plugin with `affectsParsing` was toggled. */
  refreshParsing(): void
  /** A plugin failed to load or activate; it stays inactive and the others keep running. */
  reportActivationError(plugin: RendererPluginEntry, error: unknown): void
  log(level: 'info' | 'warn' | 'error', message: string, ...details: unknown[]): void
}

interface ActivePlugin {
  module: RendererPluginModule | null
  handle: PluginContextHandle
}

/**
 * Runs the renderer parts of the built-in plugins in this window: activates
 * every enabled plugin (unless the app runs in safe mode) and follows the
 * enabled flags main pushes. Activations and deactivations of one plugin are
 * serialized; a plugin that throws while activating is reported and left
 * inactive without affecting the others, and deactivation disposes all of a
 * plugin's registrations even when its `deactivate` throws.
 */
export class PluginManager {
  private readonly active = new Map<string, ActivePlugin>()
  private readonly transitions = new Map<string, Promise<void>>()
  private stateSubscription: Disposable | null = null
  private stopped = false

  constructor(private readonly options: PluginManagerOptions) {}

  isActive(id: string): boolean {
    return this.active.has(id)
  }

  /** Loads the host state and activates the enabled plugins; resolves when the initial pass settled. */
  async start(): Promise<void> {
    const state = await this.options.stateClient.load()
    if (this.stopped) return
    this.stateSubscription = this.options.stateClient.onDidChange((next) => {
      this.sync(next, true)
    })
    await this.sync(state, false)
  }

  /** Deactivates every plugin (window teardown); no further state changes are followed. */
  async stop(): Promise<void> {
    this.stopped = true
    this.stateSubscription?.dispose()
    this.stateSubscription = null
    await Promise.all([...this.active.keys()].map((id) => this.enqueue(id, () => this.deactivate(id))))
  }

  private sync(state: PluginHostState, toggled: boolean): Promise<void> {
    const pending: Promise<void>[] = []
    for (const plugin of this.options.plugins) {
      const { id } = plugin.manifest
      const shouldRun = !state.safeMode && !!state.enabled[id]
      const transition = shouldRun
        ? () => this.activate(plugin, toggled)
        : () => this.deactivate(id, toggled)
      // Only plugins whose target state differs from the current or queued one need work.
      if (shouldRun !== this.isActive(id) || this.transitions.has(id)) {
        pending.push(this.enqueue(id, transition))
      }
    }
    return Promise.all(pending).then(() => undefined)
  }

  private enqueue(id: string, transition: () => Promise<void>): Promise<void> {
    const next = (this.transitions.get(id) ?? Promise.resolve()).then(transition).finally(() => {
      if (this.transitions.get(id) === next) this.transitions.delete(id)
    })
    this.transitions.set(id, next)
    return next
  }

  private async activate(plugin: RendererPluginEntry, toggled: boolean): Promise<void> {
    const { id } = plugin.manifest
    if (this.active.has(id) || this.stopped) return
    const handle = this.options.createContext(plugin)
    const record: ActivePlugin = { module: null, handle }
    this.active.set(id, record)
    try {
      record.module = await plugin.load()
      await record.module.activate(handle.ctx)
    } catch (err) {
      this.active.delete(id)
      handle.dispose()
      this.options.reportActivationError(plugin, err)
      return
    }
    this.options.log('info', `[plugins] activated ${id}`)
    if (toggled && plugin.manifest.affectsParsing) this.options.refreshParsing()
  }

  private async deactivate(id: string, toggled = false): Promise<void> {
    const record = this.active.get(id)
    if (!record) return
    this.active.delete(id)
    try {
      await record.module?.deactivate?.()
    } catch (err) {
      this.options.log('error', `[plugins] ${id} failed to deactivate:`, err)
    } finally {
      record.handle.dispose()
    }
    const plugin = this.options.plugins.find((p) => p.manifest.id === id)
    if (toggled && plugin?.manifest.affectsParsing) this.options.refreshParsing()
  }
}
