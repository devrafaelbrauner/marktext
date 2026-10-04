import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { validateSender } from '../security/validateSender'
import type { VaultIndexManager } from './manager'

const windowIdOf = (event: IpcMainInvokeEvent): number => {
  if (!validateSender(event)) throw new Error('IPC sender rejected')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('IPC sender rejected')
  return win.id
}

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
}

/** Registers the `mt::index::*` invoke handlers; each answers for the calling window's opened folder. */
export const registerVaultIndexIpc = (manager: VaultIndexManager): void => {
  ipcMain.handle('mt::index::is-ready', (event) => manager.isReady(windowIdOf(event)))
  ipcMain.handle('mt::index::get-file', (event, pathname: unknown) =>
    manager.query(windowIdOf(event), 'getFile', [requireString(pathname, 'path')])
  )
  ipcMain.handle('mt::index::list-files', (event) => manager.query(windowIdOf(event), 'listFiles', []))
  ipcMain.handle('mt::index::resolve-link', (event, target: unknown, sourcePath: unknown) =>
    manager.query(windowIdOf(event), 'resolveLink', [
      requireString(target, 'target'),
      requireString(sourcePath, 'sourcePath')
    ])
  )
  ipcMain.handle('mt::index::backlinks', (event, pathname: unknown) =>
    manager.query(windowIdOf(event), 'getBacklinks', [requireString(pathname, 'path')])
  )
  ipcMain.handle('mt::index::tags', (event) => manager.query(windowIdOf(event), 'getTags', []))
  ipcMain.handle('mt::index::files-with-tag', (event, tag: unknown, options: unknown) => {
    const includeNested =
      typeof options === 'object' && options !== null && 'includeNested' in options && options.includeNested === true
    return manager.query(windowIdOf(event), 'getFilesWithTag', [requireString(tag, 'tag'), { includeNested }])
  })
  ipcMain.handle('mt::index::request', (event, type: unknown, payload: unknown) =>
    manager.request(windowIdOf(event), requireString(type, 'type'), payload)
  )
}
