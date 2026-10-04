import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import type { SaveDialogRequest } from '@shared/types/ipc'
import { showSaveDialogScoped } from '../security/pathGrants'

export const registerDialogHandlers = (): void => {
  ipcMain.handle('mt::dialog::show-save', async(event, request: SaveDialogRequest) => {
    try {
      const options = {
        title: request?.title,
        defaultPath: request?.defaultPath,
        filters: request?.filters
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await showSaveDialogScoped(win, options)

      return result.canceled ? null : (result.filePath ?? null)
    } catch (err) {
      log.error('dialog.showSaveDialog failed:', err)
      return null
    }
  })
}
