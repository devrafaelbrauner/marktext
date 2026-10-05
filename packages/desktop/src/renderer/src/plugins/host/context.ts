import type { Ref } from 'vue'
import type {
  Disposable,
  PluginLocales,
  PluginManifest,
  PluginSettingValue
} from '@shared/plugins/types'
import { registerPluginCommand, type PluginCommandServices } from '../registries/commands'
import { registerSidebarPanel } from '../registries/sidebarPanels'
import { registerStatusBarItem } from '../registries/statusBar'
import type {
  ActiveTabInfo,
  EditorApi,
  MetadataApi,
  RendererPluginContext,
  TabViewContribution,
  UiApi,
  VaultApi,
  WorkspaceApi
} from '../types'
import type { EngineHost } from './engine'
import { unwrapIpcResult, PluginError } from './errors'
import { resolveSetting, type PluginStateClient } from './pluginState'

/** Window-level facilities a plugin context is built from; one instance per window. */
export interface PluginHostServices {
  engine: EngineHost
  vault: VaultApi
  metadata: MetadataApi
  stateClient: PluginStateClient
  commands: PluginCommandServices
  bridge: Pick<PluginsAPI, 'invoke' | 'onEvent'>
  language: Readonly<Ref<string>>
  translate(pluginId: string, key: string, params?: Record<string, string | number>): string
  getActiveTab(): ActiveTabInfo | null
  onDidChangeActiveTab(listener: (tab: ActiveTabInfo | null) => void): Disposable
  /** Markdown of the active markdown tab, or null. */
  getMarkdown(): string | null
  getRootPath(): string | null
  onDidChangeRootPath(listener: (rootPath: string | null) => void): Disposable
  openFile(pathname: string, options?: { anchor?: string; subpath?: string }): Promise<void>
  registerTabView(ctx: RendererPluginContext, view: TabViewContribution): Disposable
  onDidRenameFile: WorkspaceApi['onDidRenameFile']
  revealSidebarPanel(panelId: string): void
  /** Called after a plugin panel left the sidebar (to move the selection away from it). */
  onSidebarPanelRemoved(panelId: string): void
  notify: UiApi['notify']
  openSettings(pluginId: string): void
  log(level: 'info' | 'warn' | 'error', message: string, ...details: unknown[]): void
}

export interface PluginContextHandle {
  ctx: RendererPluginContext
  /** Disposes everything registered through `ctx`, newest first; never throws. */
  dispose(): void
}

export interface PluginDescriptor {
  manifest: PluginManifest
  locales: PluginLocales
}

const sameValue = (a: PluginSettingValue | undefined, b: PluginSettingValue | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * Builds the `RendererPluginContext` of one plugin. Every registration made
 * through it is tracked and undone by `dispose()`; decoration layers are
 * namespaced by plugin id so two plugins never overwrite each other's layer.
 */
export const createPluginContext = (
  plugin: PluginDescriptor,
  services: PluginHostServices
): PluginContextHandle => {
  const { manifest } = plugin
  const { id } = manifest
  const { engine } = services
  const tracked: Disposable[] = []
  const decorationLayers = new Set<string>()
  let disposed = false

  const track = <T extends Disposable>(disposable: T): T => {
    if (disposed) {
      disposable.dispose()
      return disposable
    }
    tracked.push(disposable)
    return disposable
  }
  const layerKey = (layerId: string): string => `${id}/${layerId}`

  const editor: EditorApi = {
    getMuya: () => engine.getMuya(),
    getActiveTab: () => services.getActiveTab(),
    onDidChangeActiveTab: (listener) => track(services.onDidChangeActiveTab(listener)),
    getMarkdown: () => services.getMarkdown(),
    onDidChangeContent: (listener) => track(engine.onDidChangeContent(listener)),
    onDidSetContent: (listener) => track(engine.onDidSetContent(listener)),
    setDecorations: (layerId, ranges) => {
      decorationLayers.add(layerId)
      engine.setDecorations(layerKey(layerId), ranges)
    },
    clearDecorations: (layerId) => {
      decorationLayers.delete(layerId)
      engine.clearDecorations(layerKey(layerId))
    },
    onDidClickDecoration: (layerId, listener) =>
      track(engine.onDidClickDecoration(layerKey(layerId), listener)),
    replaceRange: (edit) => engine.replaceRange(edit),
    getCheckableBlocks: (paths) => engine.getCheckableBlocks(paths),
    insertText: (text) => engine.insertText(text),
    insertMarkdownBlocks: (markdown, after) => engine.insertMarkdownBlocks(markdown, after),
    getSelection: () => engine.getSelection(),
    registerInlineSyntax: (rule) => track(engine.registerInlineSyntax(rule)),
    onDidClickInlineToken: (name, listener) => track(engine.onDidClickInlineToken(name, listener)),
    registerCodeBlockRenderer: (renderer) => track(engine.registerCodeBlockRenderer(renderer)),
    registerCompletionProvider: (provider) => track(engine.registerCompletionProvider(provider)),
    requestEngineOptions: (options) => track(engine.requestEngineOptions(options))
  }

  const workspace: WorkspaceApi = {
    getRootPath: () => services.getRootPath(),
    onDidChangeRootPath: (listener) => track(services.onDidChangeRootPath(listener)),
    openFile: (pathname, options) => services.openFile(pathname, options),
    createAndOpenFile: async(pathname, content) => {
      try {
        await services.vault.createText(pathname, content)
      } catch (err) {
        if (!(err instanceof PluginError && err.code === 'EXISTS')) throw err
      }
      await services.openFile(pathname)
    },
    registerTabView: (view) => track(services.registerTabView(ctx, view)),
    onDidRenameFile: (listener) => track(services.onDidRenameFile(listener))
  }

  const ui: UiApi = {
    registerSidebarPanel: (panel) => {
      const registration = registerSidebarPanel(ctx, panel)
      return track({
        dispose: () => {
          registration.dispose()
          services.onSidebarPanelRemoved(panel.id)
        }
      })
    },
    revealSidebarPanel: (panelId) => services.revealSidebarPanel(panelId),
    registerStatusBarItem: (item) => track(registerStatusBarItem(ctx, item)),
    notify: (options) => services.notify(options),
    openSettings: () => services.openSettings(id)
  }

  const source = services.metadata
  const metadata: MetadataApi = {
    isReady: () => source.isReady(),
    onDidBecomeReady: (listener) => track(source.onDidBecomeReady(listener)),
    onDidChange: (listener) => track(source.onDidChange(listener)),
    getFile: (path) => source.getFile(path),
    listFiles: () => source.listFiles(),
    resolveLink: (target, sourcePath) => source.resolveLink(target, sourcePath),
    getBacklinks: (path) => source.getBacklinks(path),
    getTags: () => source.getTags(),
    getFilesWithTag: (tag, options) => source.getFilesWithTag(tag, options),
    request: (type, payload) => source.request(type, payload)
  }

  const ctx: RendererPluginContext = {
    id,
    manifest,
    t: (key, params) => services.translate(id, key, params),
    language: services.language,
    commands: {
      register: (command) => track(registerPluginCommand(ctx, command, services.commands))
    },
    ui,
    editor,
    workspace,
    vault: services.vault,
    metadata,
    settings: {
      get: <T extends PluginSettingValue>(key: string) =>
        resolveSetting(services.stateClient.state.value, manifest, key) as T,
      set: (key, value) => services.stateClient.setSetting(id, key, value),
      onDidChange: (listener) =>
        track(
          services.stateClient.onDidChange((state, previous) => {
            for (const schema of manifest.settings ?? []) {
              if (schema.type === 'secret') continue
              const next = resolveSetting(state, manifest, schema.key)
              if (next !== undefined && !sameValue(next, resolveSetting(previous, manifest, schema.key))) {
                listener(schema.key, next)
              }
            }
          })
        ),
      isSecretSet: (key) => services.stateClient.isSecretSet(id, key)
    },
    ipc: {
      invoke: async<T>(method: string, ...args: unknown[]) =>
        unwrapIpcResult(await services.bridge.invoke(id, method, args)) as T,
      on: (event, listener) =>
        track({
          dispose: services.bridge.onEvent((pluginId, name, payload) => {
            if (pluginId === id && name === event) listener(payload)
          })
        })
    },
    track
  }

  return {
    ctx,
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const layerId of decorationLayers) {
        try {
          engine.clearDecorations(layerKey(layerId))
        } catch (err) {
          services.log('error', `[${id}] clearing decorations failed:`, err)
        }
      }
      decorationLayers.clear()
      for (const disposable of tracked.splice(0).reverse()) {
        try {
          disposable.dispose()
        } catch (err) {
          services.log('error', `[${id}] dispose failed:`, err)
        }
      }
    }
  }
}
