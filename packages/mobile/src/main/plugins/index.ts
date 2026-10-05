// Plugin host of the Android main side: the unchanged desktop
// `MainPluginHost` (built-in main parts such as grammar and ai run here, in
// the WebView) with Android storage, Keystore secrets and CapacitorHttp, plus
// the `mt::plugins::*`, `mt::vault::*` and `mt::community::*` channels of
// desktop `main/plugins/ipc.ts` and `main/community/ipc.ts`.
//
// Desktop validates that each sender is an app window's top frame. Here the
// only IPC callers are the app's own documents: community plugin iframes are
// sandboxed on another origin and reach the host only through MessagePorts.

import { posix } from 'pathe'
import { BUILTIN_PLUGINS } from '@plugins/manifests'
import type { PluginHostState } from '@shared/plugins/types'
import { BUILTIN_MAIN_PLUGINS } from '../../../../desktop/src/main/plugins/builtin'
import { PluginError, toIpcResult } from '../../../../desktop/src/main/plugins/errors'
import { MainPluginHost, type PluginLogger } from '../../../../desktop/src/main/plugins/host'
import { PluginStateStore, type PersistedPluginState, type PluginStateBacking } from '../../../../desktop/src/main/plugins/stateStore'
import { communityFetch } from '../../../../desktop/src/main/community/fetch'
import { USER_DATA_PATH } from '../boot'
import type { FileBackend } from '../fs/backend'
import { EDITOR_WINDOW_ID, ipcMain, push, pushTo } from '../ipc'
import { openSettingsWindow } from '../settingsWindow'
import { getActiveFile, getBackend, getRootPath, setActiveFile } from '../state'
import { MobileCommunityRegistry } from './community'
import { createSafeFetch } from './net'
import { createPluginSecrets, type CachedPluginSecrets } from './secrets'
import { VaultFiles } from './vault'

export const PLUGINS_STATE_PATH = `${USER_DATA_PATH}/plugins.json`

const createLogger = (scope: string): PluginLogger => ({
  info: (...args) => console.info(`[${scope}]`, ...args),
  warn: (...args) => console.warn(`[${scope}]`, ...args),
  error: (...args) => console.error(`[${scope}]`, ...args)
})

/**
 * `plugins.json` behind the synchronous `PluginStateStore`: read once before
 * the store is built, written in order after every change. A corrupted file
 * only holds toggles and settings, so it resets instead of blocking startup.
 */
export async function jsonStateBacking(backend: FileBackend, path: string): Promise<PluginStateBacking> {
  let initial: unknown = {}
  try {
    if (await backend.stat(path)) initial = JSON.parse(await backend.readText(path))
  } catch (err) {
    console.warn(`[plugins] ignoring unreadable ${path}:`, err)
  }
  let writes = Promise.resolve()
  return {
    read: () => initial,
    write: (state: PersistedPluginState) => {
      const json = JSON.stringify(state)
      writes = writes
        .then(() => backend.writeFile(path, json))
        .catch((err) => console.error(`[plugins] failed to save ${path}:`, err))
    }
  }
}

export interface MobilePluginHost {
  host: MainPluginHost
  community: MobileCommunityRegistry
  secrets: CachedPluginSecrets
  /** Resolves once every state change so far reached the renderer. */
  settled(): Promise<void>
}

/** Builds the host over the installed backend; `registerPlugins` wires it to IPC. */
export async function createMobilePluginHost(
  backend: FileBackend,
  secrets: CachedPluginSecrets,
  fetch = createSafeFetch()
): Promise<MobilePluginHost> {
  const manifests = BUILTIN_PLUGINS.map((plugin) => plugin.manifest)
  const store = new PluginStateStore(manifests, await jsonStateBacking(backend, PLUGINS_STATE_PATH))
  const community = new MobileCommunityRegistry({
    backend,
    userDataPath: USER_DATA_PATH,
    builtinIds: manifests.map((manifest) => manifest.id),
    appVersion: MARKTEXT_VERSION,
    log: (message) => console.warn(`[community] ${message}`)
  })
  await community.load()

  // The native handler serves a community plugin only once its host
  // documents exist, so they are written before the renderer learns the
  // plugin is enabled; the chain keeps state pushes in order.
  let publishing = Promise.resolve()
  const publishState = (state: PluginHostState): void => {
    publishing = publishing
      .then(() => community.syncServable(state))
      .catch((err) => console.error('[community] failed to update served plugins:', err))
      .then(() => push('mt::plugins::state-changed', state))
  }

  const host = new MainPluginHost({
    manifests,
    plugins: BUILTIN_MAIN_PLUGINS,
    store,
    secrets,
    // Android has no `--safe` launch flag.
    safeMode: false,
    fetch,
    createLogger,
    community,
    publishState,
    publishEvent: (pluginId, event, payload, windowId) => {
      const send = windowId === undefined ? push : pushTo(windowId)
      send('mt::plugins::event', pluginId, event, payload)
    }
  })
  await community.syncServable(host.getState())
  return { host, community, secrets, settled: () => publishing }
}

/** Registers the plugin, vault and community channels for `plugins`. */
export function registerPluginIpc({ host, community }: MobilePluginHost, backend: FileBackend, fetch = createSafeFetch()): void {
  ipcMain.handle('mt::plugins::get-state', () => host.getState())
  ipcMain.handle('mt::plugins::set-enabled', (_event, id, enabled) =>
    toIpcResult(async() => {
      await host.setEnabled(id, enabled)
      return null
    })
  )
  ipcMain.handle('mt::plugins::set-setting', (_event, id, key, value) =>
    toIpcResult(() => {
      host.setSetting(id, key, value)
      return null
    })
  )
  ipcMain.handle('mt::plugins::set-secret', (_event, id, key, value) =>
    toIpcResult(async() => {
      await host.setSecret(id, key, value)
      return null
    })
  )
  ipcMain.handle('mt::plugins::invoke', (event, id, method, args) =>
    toIpcResult(() => host.invoke(id, method, args, { windowId: event.sender.id, webContentsId: event.sender.id }))
  )
  ipcMain.on('mt::plugins::open-settings', (_event, id) => {
    if (typeof id === 'string' && host.getState().enabled[id] !== undefined) openSettingsWindow(`plugins/${id}`)
  })

  // Only the editor window reports its active file; the settings window has none.
  ipcMain.on('mt::vault::set-active-file', (event, pathname) => {
    if (event.sender.id !== EDITOR_WINDOW_ID) return
    setActiveFile(typeof pathname === 'string' && posix.isAbsolute(pathname) ? posix.resolve(pathname) : null)
  })
  const vault = new VaultFiles(backend, () => {
    const activeFile = getActiveFile()
    return getRootPath() ?? (activeFile ? posix.dirname(activeFile) : null)
  })
  ipcMain.handle('mt::vault::read-text', (_event, target) => toIpcResult(() => vault.readText(target)))
  ipcMain.handle('mt::vault::read-binary', (_event, target, maxBytes) => toIpcResult(() => vault.readBinary(target, maxBytes)))
  ipcMain.handle('mt::vault::write-text', (_event, target, content, expectedMtimeMs) =>
    toIpcResult(() => vault.writeText(target, content, expectedMtimeMs))
  )
  ipcMain.handle('mt::vault::create-text', (_event, target, content) => toIpcResult(() => vault.createText(target, content)))
  ipcMain.handle('mt::vault::exists', (_event, target) => toIpcResult(() => vault.exists(target)))
  ipcMain.handle('mt::vault::list', (_event, extensions) => toIpcResult(() => vault.list(extensions)))

  ipcMain.handle('mt::community::install', (_event, kind) =>
    toIpcResult(async() => {
      if (kind !== 'folder' && kind !== 'zip') throw new PluginError('FAILED', 'Install kind must be folder or zip')
      const picked = kind === 'folder'
        ? await backend.pickDirectory()
        : await backend.pickOpenFile(['application/zip'])
      if (!picked) throw new PluginError('FAILED', 'CANCELED')
      try {
        const record = kind === 'folder'
          ? await community.installFolder(picked.path)
          : await community.installZip(picked.path)
        // A previous install may have left `enabled: true` in plugins.json.
        // Installing always starts disabled until the user consents again.
        await host.setEnabled(record.id, false)
        return { id: record.id, name: record.name }
      } catch (err) {
        throw new PluginError('FAILED', err instanceof Error ? err.message : String(err))
      }
    })
  )
  ipcMain.handle('mt::community::uninstall', (_event, id) =>
    toIpcResult(async() => {
      if (typeof id !== 'string' || !community.get(id)) throw new PluginError('NOT_FOUND', 'Plugin is not installed')
      if (host.getState().enabled[id]) await host.setEnabled(id, false)
      try {
        await community.uninstall(id)
      } catch (err) {
        throw new PluginError('FAILED', err instanceof Error ? err.message : String(err))
      }
      host.publish()
      return null
    })
  )
  ipcMain.handle('mt::community::set-enabled', (_event, id, enabled) =>
    toIpcResult(async() => {
      if (typeof id !== 'string' || !community.get(id)) throw new PluginError('NOT_FOUND', 'Plugin is not installed')
      if (typeof enabled !== 'boolean') throw new PluginError('FAILED', 'enabled must be a boolean')
      if (enabled) await community.grant(id)
      await host.setEnabled(id, enabled)
      return null
    })
  )
  ipcMain.handle('mt::community::fetch', (_event, id, url, init) =>
    toIpcResult(() => communityFetch({
      id,
      url,
      init,
      record: typeof id === 'string' ? community.get(id) : undefined,
      active: typeof id === 'string' && !!host.getState().enabled[id] && !host.safeMode,
      fetch
    }))
  )
}

/**
 * Builds the plugin host, registers its channels and activates the enabled
 * built-in main parts. Needs the FileBackend installed (`setBackend`) first.
 */
export async function registerPlugins(): Promise<void> {
  const backend = getBackend()
  const fetch = createSafeFetch()
  const plugins = await createMobilePluginHost(backend, await createPluginSecrets(), fetch)
  registerPluginIpc(plugins, backend, fetch)
  plugins.host.start().catch((err) => console.error('[plugins] host failed to start:', err))
}

declare const MARKTEXT_VERSION: string
