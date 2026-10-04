import { app, BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { BUILTIN_PLUGINS } from '@plugins/manifests'
import { SecretsStore } from '../security/secretsStore'
import { safeFetch } from '../security/safeFetch'
import { CommunityRegistry } from '../community/registry'
import { registerCommunityIpc } from '../community/ipc'
import { startCommunityProtocol } from '../community/protocol'
import { BUILTIN_MAIN_PLUGINS } from './builtin'
import { MainPluginHost } from './host'
import { registerPluginIpcHandlers } from './ipc'
import { PluginStateStore, type PersistedPluginState } from './stateStore'
const PLUGINS_STORE_NAME = 'plugins'

/**
 * Builds the app's plugin host: `plugins.json` (electron-store) for enabled
 * flags and settings, `secrets.json` for secret settings, and push events to
 * every open window.
 */
export const createMainPluginHost = (userDataPath: string, safeMode: boolean): MainPluginHost => {
  const manifests = BUILTIN_PLUGINS.map((p) => p.manifest)
  // A corrupted plugins.json only holds toggles and settings; resetting it beats refusing to start.
  const electronStore = new Store<Record<string, unknown>>({ name: PLUGINS_STORE_NAME, clearInvalidConfig: true })
  const store = new PluginStateStore(manifests, {
    read: () => electronStore.store,
    write: (state: PersistedPluginState) => {
      electronStore.store = { ...state }
    }
  })
  const community = new CommunityRegistry({
    userDataPath,
    builtinIds: manifests.map((manifest) => manifest.id),
    appVersion: MARKTEXT_VERSION,
    log: (message) => log.warn(message)
  })
  const host = new MainPluginHost({
    manifests,
    plugins: BUILTIN_MAIN_PLUGINS,
    store,
    secrets: new SecretsStore(userDataPath),
    safeMode,
    fetch: (url, init) => safeFetch(url, init),
    createLogger: (scope) => log.scope(scope),
    community,
    publishState: (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('mt::plugins::state-changed', state)
      }
    },
    publishEvent: (pluginId, event, payload, windowId) => {
      const targets = windowId === undefined
        ? BrowserWindow.getAllWindows()
        : [BrowserWindow.fromId(windowId)].filter((win): win is BrowserWindow => win !== null)
      for (const win of targets) {
        if (!win.isDestroyed()) win.webContents.send('mt::plugins::event', pluginId, event, payload)
      }
    }
  })
  registerCommunityIpc({ host, registry: community })
  startCommunityProtocol({
    registry: community,
    isServable: (id) => !safeMode && !!host.getState().enabled[id]
  })
  return host
}

/**
 * Registers the plugin IPC channels, activates the enabled main parts once
 * the app is ready and deactivates them before the app quits.
 */
export const startMainPluginHost = (
  host: MainPluginHost,
  getOpenedFolder: (windowId: number) => string | null
): void => {
  registerPluginIpcHandlers({
    host,
    getOpenedFolder: (sender) => {
      const win = BrowserWindow.fromWebContents(sender)
      return win ? getOpenedFolder(win.id) : null
    },
    openSettings: (pluginId) => ipcMain.emit('app-create-settings-window', `plugins/${pluginId}`)
  })

  app.whenReady()
    .then(() => host.start())
    .catch((err) => log.error('Plugin host failed to start:', err))

  app.on('will-quit', (event) => {
    if (!host.hasActivePlugins()) return
    event.preventDefault()
    host.stop().finally(() => app.quit())
  })
}
