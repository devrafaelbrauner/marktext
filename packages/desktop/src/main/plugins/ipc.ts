import path from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { PluginIpcResult } from '@shared/types/ipc'
import { validateSender } from '../security/validateSender'
import { toIpcResult } from './errors'
import type { MainPluginHost } from './host'
import { createText, exists, listFiles, readBinary, readText, writeText } from './vaultFs'

export interface PluginIpcOptions {
  host: MainPluginHost
  /** Folder opened in the window showing `sender`, or null. */
  getOpenedFolder(sender: WebContents): string | null
  /** Opens Preferences on the settings of `pluginId` (already validated). */
  openSettings(pluginId: string): void
}

const forbidden = (): PluginIpcResult<never> => ({
  ok: false,
  error: { code: 'FAILED', message: 'Request from an untrusted sender' }
})

/**
 * Registers the `mt::plugins::*` and `mt::vault::*` channels. Every handler
 * rejects senders that are not the top frame of an app window. Vault calls
 * are scoped to the window's opened folder or, without one, to the folder of
 * the file the window reported as active (`mt::vault::set-active-file`).
 */
export const registerPluginIpcHandlers = ({ host, getOpenedFolder, openSettings }: PluginIpcOptions): void => {
  const activeFiles = new Map<number, string>()
  const cleanupRegistered = new WeakSet<WebContents>()

  const vaultRoot = (sender: WebContents): string | null => {
    const folder = getOpenedFolder(sender)
    if (folder) return folder
    const activeFile = activeFiles.get(sender.id)
    return activeFile ? path.dirname(activeFile) : null
  }

  const handleVault = <A extends unknown[], T>(
    channel: string,
    run: (root: string | null, ...args: A) => Promise<T>
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!validateSender(event)) return forbidden()
      return toIpcResult(() => run(vaultRoot(event.sender), ...(args as A)))
    })
  }

  ipcMain.handle('mt::plugins::get-state', (event) => {
    if (!validateSender(event)) throw new Error('Request from an untrusted sender')
    return host.getState()
  })
  ipcMain.handle('mt::plugins::set-enabled', (event, id: unknown, enabled: unknown) => {
    if (!validateSender(event)) return forbidden()
    return toIpcResult(async() => {
      await host.setEnabled(id, enabled)
      return null
    })
  })
  ipcMain.handle('mt::plugins::set-setting', (event, id: unknown, key: unknown, value: unknown) => {
    if (!validateSender(event)) return forbidden()
    return toIpcResult(() => {
      host.setSetting(id, key, value)
      return null
    })
  })
  ipcMain.handle('mt::plugins::set-secret', (event, id: unknown, key: unknown, value: unknown) => {
    if (!validateSender(event)) return forbidden()
    return toIpcResult(async() => {
      await host.setSecret(id, key, value)
      return null
    })
  })
  ipcMain.handle('mt::plugins::invoke', (event, id: unknown, method: unknown, args: unknown) => {
    if (!validateSender(event)) return forbidden()
    const call = {
      windowId: BrowserWindow.fromWebContents(event.sender)?.id ?? null,
      webContentsId: event.sender.id
    }
    return toIpcResult(() => host.invoke(id, method, args, call))
  })
  ipcMain.on('mt::plugins::open-settings', (event: IpcMainEvent, id: unknown) => {
    if (!validateSender(event)) return
    if (typeof id === 'string' && host.getState().enabled[id] !== undefined) openSettings(id)
  })

  ipcMain.on('mt::vault::set-active-file', (event: IpcMainEvent, pathname: unknown) => {
    if (!validateSender(event)) return
    const { sender } = event
    if (typeof pathname === 'string' && path.isAbsolute(pathname)) {
      if (!cleanupRegistered.has(sender)) {
        cleanupRegistered.add(sender)
        sender.once('destroyed', () => activeFiles.delete(sender.id))
      }
      activeFiles.set(sender.id, path.resolve(pathname))
    } else {
      activeFiles.delete(sender.id)
    }
  })
  handleVault('mt::vault::read-text', (root, target: unknown) => readText(root, target))
  handleVault('mt::vault::read-binary', (root, target: unknown, maxBytes: unknown) =>
    readBinary(root, target, maxBytes)
  )
  handleVault('mt::vault::write-text', (root, target: unknown, content: unknown, expectedMtimeMs: unknown) =>
    writeText(root, target, content, expectedMtimeMs)
  )
  handleVault('mt::vault::create-text', async(root, target: unknown, content: unknown) => {
    await createText(root, target, content)
    return null
  })
  handleVault('mt::vault::exists', (root, target: unknown) => exists(root, target))
  handleVault('mt::vault::list', (root, extensions: unknown) => listFiles(root, extensions))
}
