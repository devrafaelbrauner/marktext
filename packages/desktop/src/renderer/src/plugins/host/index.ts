import { computed, watch } from 'vue'
import log from 'electron-log'
import bus from '@/bus'
import { i18n, registerPluginLocales, t, translatePluginKey } from '@/i18n'
import notice from '@/services/notification'
import { useCommandCenterStore } from '@/store/commandCenter'
import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { useProjectStore } from '@/store/project'
import { isMac } from '@/util'
import type { Disposable } from '@shared/plugins/types'
import { BUILTIN_RENDERER_PLUGINS } from '../builtin'
import { BUILTIN_SIDEBAR_PANEL_IDS, getSidebarPanel } from '../registries/sidebarPanels'
import { markTabViewsReady, registerTabView } from '../registries/tabViews'
import type { ActiveTabInfo, PluginCommand, RendererPluginContext } from '../types'
import { createPluginContext, type PluginHostServices } from './context'
import { startCommunityRuntime } from '../community/manager'
import { onDidRenameFile } from './fileRenames'
import { EngineHost } from './engine'
import { PluginKeybindings } from './keybindings'
import { PluginManager } from './manager'
import { createMetadataApi } from './metadataApi'
import { PluginStateClient } from './pluginState'
import { createVaultApi } from './vaultApi'

/** Engine bridge of this window; the editor attaches its Muya instance here. */
export const engineHost = new EngineHost({
  getActiveTabId: () => useEditorStore().currentFile?.id ?? null,
  isMac
})

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const writeLog = (level: 'info' | 'warn' | 'error', message: string, ...details: unknown[]): void => {
  log[level](message, ...details)
}

const notifyError = (title: string, error: unknown): void => {
  notice
    .notify({
      title: escapeHtml(title),
      message: escapeHtml(error instanceof Error ? error.message : String(error)),
      type: 'error'
    })
    .catch(() => {})
}

const getActiveTab = (): ActiveTabInfo | null => {
  const file = useEditorStore().currentFile
  if (!file) return null
  return {
    id: file.id,
    pathname: file.pathname || null,
    filename: file.filename,
    isSaved: file.isSaved,
    kind: file.kind,
    viewId: file.viewId
  }
}

const watchValue = <T>(read: () => T, listener: (value: T) => void): Disposable => {
  const stop = watch(read, (value) => listener(value))
  return { dispose: stop }
}

const createServices = (stateClient: PluginStateClient): PluginHostServices => {
  const editorStore = useEditorStore()
  const layoutStore = useLayoutStore()
  const projectStore = useProjectStore()
  const keybindings = new PluginKeybindings(window, isMac, (message) => log.warn(`[plugins] ${message}`))
  window.electron.ipcRenderer.on('mt::keybindings-response', (_e, map) => {
    keybindings.setAppKeybindings(map as Record<string, string>)
  })

  return {
    engine: engineHost,
    vault: createVaultApi({
      bridge: window.vault,
      updateOpenTab: (pathname, markdown) =>
        engineHost.asApi(() => editorStore.UPDATE_TAB_MARKDOWN_BY_PATH(pathname, markdown))
    }),
    metadata: createMetadataApi(),
    stateClient,
    commands: {
      commandCenter: useCommandCenterStore(),
      keybindings,
      isMac,
      reportError: (ctx: RendererPluginContext, command: PluginCommand, error: unknown) => {
        log.error(`[plugins] command "${command.id}" of ${ctx.id} failed:`, error)
        notifyError(t('pluginHost.commandFailed', { command: ctx.t(command.title) }), error)
      }
    },
    bridge: window.plugins,
    language: computed(() => i18n.global.locale.value),
    translate: translatePluginKey,
    getActiveTab,
    onDidChangeActiveTab: (listener) =>
      watchValue(
        () => JSON.stringify(getActiveTab()),
        () => listener(getActiveTab())
      ),
    getMarkdown: () => {
      const file = editorStore.currentFile
      return file && file.kind === 'markdown' ? file.markdown : null
    },
    getRootPath: () => projectStore.projectTree?.pathname || null,
    onDidChangeRootPath: (listener) =>
      watchValue(() => projectStore.projectTree?.pathname || null, listener),
    openFile: async(pathname, options) => {
      window.electron.ipcRenderer.send('mt::open-file', pathname, { ...options })
    },
    registerTabView,
    onDidRenameFile,
    revealSidebarPanel: (panelId) => {
      layoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: panelId })
    },
    onSidebarPanelRemoved: (panelId) => {
      if (layoutStore.rightColumn === panelId) layoutStore.SET_LAYOUT({ rightColumn: 'files' })
    },
    notify: ({ title, message, type, timeout }) => {
      notice
        .notify({
          title: escapeHtml(title ?? ''),
          message: escapeHtml(message),
          type: type ?? 'info',
          ...(timeout === undefined ? {} : { time: timeout })
        })
        .catch(() => {})
    },
    openSettings: (pluginId) => window.plugins.openSettings(pluginId),
    log: writeLog
  }
}

let starting: Promise<void> | null = null

/**
 * Starts the plugin host of an editor window (once): activates the enabled
 * built-in plugins, reports content changes and the active file to them and
 * to main, and finally releases the tab-view registry so pending asset tabs
 * can open. Must run after Pinia is installed.
 */
export const startPluginHost = (): Promise<void> => {
  if (starting) return starting
  const editorStore = useEditorStore()
  const layoutStore = useLayoutStore()
  const stateClient = new PluginStateClient(window.plugins)
  const services = createServices(stateClient)

  editorStore.$onAction(({ name, args, after }) => {
    if (name !== 'LISTEN_FOR_CONTENT_CHANGE') return
    const payload = args[0] as { id?: string } | undefined
    after(() => {
      if (payload?.id) engineHost.notifyContentChange(payload.id)
    })
  })
  bus.on('undo', () => engineHost.notifyHistoryRequest())
  bus.on('redo', () => engineHost.notifyHistoryRequest())

  // Main scopes plugin file access to this file's folder when no folder is open.
  watch(
    () => editorStore.currentFile?.pathname || null,
    (pathname) => window.vault.setActiveFile(pathname),
    { immediate: true }
  )

  const manager = new PluginManager({
    plugins: BUILTIN_RENDERER_PLUGINS,
    stateClient,
    createContext: (plugin) => {
      registerPluginLocales(plugin.manifest.id, plugin.locales)
      return createPluginContext(plugin, services)
    },
    refreshParsing: () => engineHost.refreshInlineRendering(),
    reportActivationError: (plugin, error) => {
      log.error(`[plugins] ${plugin.manifest.id} failed to activate:`, error)
      const name = translatePluginKey(plugin.manifest.id, plugin.manifest.name)
      notifyError(t('pluginHost.activationFailed', { name }), error)
    },
    log: writeLog
  })
  const community = startCommunityRuntime(services, stateClient)
  window.addEventListener('pagehide', () => {
    manager.stop()
    community.stop()
  })

  starting = manager
    .start()
    .catch((err) => log.error('[plugins] host failed to start:', err))
    .finally(() => {
      // A panel restored from the last session whose plugin is gone (disabled,
      // failed, safe mode) would leave an empty sidebar column.
      const column = layoutStore.rightColumn
      if (column && !BUILTIN_SIDEBAR_PANEL_IDS.includes(column) && !getSidebarPanel(column)) {
        layoutStore.SET_LAYOUT({ rightColumn: 'files' })
      }
      markTabViewsReady()
    })
  return starting
}
