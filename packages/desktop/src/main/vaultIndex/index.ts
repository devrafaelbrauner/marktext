import path from 'path'
import { app, BrowserWindow, utilityProcess } from 'electron'
import log from 'electron-log'
import Watcher from '../filesystem/watcher'
import { onInternalChannel } from '../utils/internalIpc'
import type Preference from '../preferences'
import { registerVaultIndexIpc } from './ipc'
import { VaultIndexManager, type IndexWorkerProcess } from './manager'
import type { WorkerToMainMessage } from './types'

/** File name of the worker bundle emitted next to the main bundle (electron.vite.config.ts `main` input). */
export const VAULT_INDEX_WORKER_FILE = 'vaultIndexWorker.js'

const spawnUtilityWorker = (rootPath: string): IndexWorkerProcess => {
  const child = utilityProcess.fork(path.join(__dirname, VAULT_INDEX_WORKER_FILE), [], {
    serviceName: `MarkText Vault Index (${path.basename(rootPath)})`,
    stdio: 'ignore'
  })
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => child.on('message', (message: WorkerToMainMessage) => listener(message)),
    onExit: (listener) => child.on('exit', listener),
    kill: () => {
      child.kill()
    }
  }
}

const readExcludePatterns = (preferences: Preference): string[] => {
  const patterns = preferences.getItem<readonly string[] | undefined>('treePathExcludePatterns')
  return Array.isArray(patterns) ? [...patterns] : []
}

/**
 * Starts the vault index service: feeds it folder watcher events, save and
 * rename notifications and exclude-pattern changes, and registers the
 * `mt::index::*` IPC handlers. Call once, before the first window opens.
 */
export const setupVaultIndex = (options: { preferences: Preference; userDataPath: string }): VaultIndexManager => {
  const { preferences, userDataPath } = options
  const manager = new VaultIndexManager({
    cacheDir: path.join(userDataPath, 'vault-index'),
    getExcludePatterns: () => readExcludePatterns(preferences),
    spawnWorker: spawnUtilityWorker,
    sendToWindow: (windowId, channel, payload) => {
      const win = BrowserWindow.fromId(windowId)
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    },
    log
  })

  Watcher.addTap((event) => manager.handleWatcherEvent(event))
  onInternalChannel('window-file-saved', (_windowId: number, pathname: string) => manager.notifySaved(pathname))
  onInternalChannel('window-change-file-path', (_windowId: number, pathname: string, oldPathname: string) =>
    manager.notifyRenamed(pathname, oldPathname)
  )
  onInternalChannel('broadcast-preferences-changed', (prefs: Record<string, unknown>) => {
    if ('treePathExcludePatterns' in prefs) manager.setExcludePatterns(readExcludePatterns(preferences))
  })
  registerVaultIndexIpc(manager)
  app.on('will-quit', () => manager.dispose())
  return manager
}
