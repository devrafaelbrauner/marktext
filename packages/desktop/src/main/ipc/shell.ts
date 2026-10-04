import { BrowserWindow, ipcMain, shell, clipboard, nativeImage } from 'electron'
import log from 'electron-log'
import * as plist from 'plist'
import { confirmOpenPath } from '../security/confirmOpenPath'
import { validateSender } from '../security/validateSender'
import { pathIsAllowed } from '../security/fsAccess'
import { grantFile } from '../security/pathGrants'

const EXTERNAL_PROTOCOLS: Record<string, true> = { 'https:': true, 'http:': true, 'mailto:': true }

/** Whether the OS may be asked to open `url`; other schemes can launch arbitrary handlers. */
export const isAllowedExternalUrl = (url: unknown): url is string => {
  if (typeof url !== 'string') return false
  try {
    return EXTERNAL_PROTOCOLS[new URL(url).protocol] === true
  } catch {
    return false
  }
}

const openExternal = async(url: unknown): Promise<boolean> => {
  if (!isAllowedExternalUrl(url)) {
    log.warn('shell.openExternal refused a URL with a disallowed scheme:', String(url).slice(0, 200))
    return false
  }
  try {
    await shell.openExternal(url)
    return true
  } catch (err) {
    log.error('shell.openExternal failed:', err)
    return false
  }
}

export const registerShellHandlers = (): void => {
  ipcMain.handle('mt::shell::open-external', (e, url: unknown) =>
    validateSender(e) ? openExternal(url) : false
  )
  ipcMain.on('mt::shell::open-external', (e, url: unknown) => {
    if (validateSender(e)) openExternal(url)
  })
  ipcMain.on('mt::shell::show-item', (e, fullPath: string) => {
    if (!validateSender(e) || typeof fullPath !== 'string') return
    pathIsAllowed(e, fullPath).then((allowed) => {
      if (!allowed) {
        log.warn('shell.showItemInFolder refused a path outside the allowed roots')
        return
      }
      try {
        shell.showItemInFolder(fullPath)
      } catch (err) {
        log.error('shell.showItemInFolder failed:', err)
      }
    }).catch((err: unknown) => {
      log.error('shell.showItemInFolder failed:', err)
    })
  })
  ipcMain.handle('mt::shell::open-path', async(e, fullPath: unknown) => {
    if (!validateSender(e) || typeof fullPath !== 'string') return 'Refused'
    try {
      if (!(await confirmOpenPath(BrowserWindow.fromWebContents(e.sender), fullPath))) return 'Cancelled'
      return await shell.openPath(fullPath)
    } catch (err) {
      log.error('shell.openPath failed:', err)
      return String(err instanceof Error ? err.message : err)
    }
  })

  ipcMain.on('mt::clipboard::write-text', (_e, text: string) => {
    try {
      clipboard.writeText(text)
    } catch (err) {
      log.error('clipboard.writeText failed:', err)
    }
  })
  ipcMain.handle('mt::clipboard::write-image', (_e, png: Uint8Array) => {
    try {
      const image = nativeImage.createFromBuffer(Buffer.from(png))
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    } catch (err) {
      log.error('clipboard.writeImage failed:', err)
      return false
    }
  })

  ipcMain.handle('mt::clipboard::read-text', () => {
    try {
      return clipboard.readText()
    } catch {
      return ''
    }
  })

  ipcMain.handle('mt::clipboard::guess-file-path', (e) => {
    if (!validateSender(e)) return ''
    try {
      let filePath = ''
      if (process.platform === 'darwin') {
        if (clipboard.has('NSFilenamesPboardType')) {
          const parsed = plist.parse(clipboard.read('NSFilenamesPboardType'))
          filePath = Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'string' ? parsed[0] : ''
        }
      } else if (process.platform === 'win32') {
        // `FileNameW` is a UTF-16LE, NUL-separated list of file paths.
        // `clipboard.read(format)` decodes the raw bytes as UTF-8, which garbles
        // non-ASCII characters; read the Buffer and decode it as UTF-16LE.
        const buffer = clipboard.readBuffer('FileNameW')
        if (buffer.length > 0) {
          filePath = buffer.toString('utf16le').split('\u0000').find(p => p.length > 0) ?? ''
        }
      }
      if (filePath) {
        const win = BrowserWindow.fromWebContents(e.sender)
        if (win) grantFile(win.id, filePath)
      }
      return filePath
    } catch (err) {
      log.error('clipboard.guess-file-path failed:', err)
      return ''
    }
  })
}
