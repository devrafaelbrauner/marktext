// Window, clipboard, shell and logging channels, local image URLs, and the
// sends that only drive desktop menus or window chrome.

import { App } from '@capacitor/app'
import { Clipboard } from '@capacitor/clipboard'
import { setLocalFileUrlBuilder } from 'common/mtFileUrl'
import { MtFs } from './fs/nativeBackend'
import type { MemoryFileBackend } from './fs/memoryBackend'
import { EDITOR_WINDOW_ID, ipcMain } from './ipc'

/**
 * Sends that update native menus, window chrome or recent-document lists on
 * desktop. Android has no menu bar, title bar buttons act on the one
 * full-screen window, and documents come from SAF grants, so these have no
 * effect. Listed in BRIDGE.md.
 */
export const NO_OP_SENDS = [
  'mt::window-initialized',
  'mt::view-layout-changed',
  'mt::update-sidebar-menu',
  'mt::update-line-ending-menu',
  'mt::update-format-menu',
  'mt::editor-selection-changed',
  'mt::set-editor-format-menus-enabled',
  'mt::add-recently-used-document',
  'menu-add-recently-used',
  'menu-clear-recently-used',
  'mt::win::minimize',
  'mt::win::maximize',
  'mt::win::unmaximize',
  'mt::win::toggle-maximize',
  'mt::win::set-fullscreen',
  'mt::win::toggle-fullscreen',
  'mt::window-toggle-always-on-top'
] as const

/** Schemes `shell.openExternal` hands to another app (desktop safeOpenExternal subset). */
export const EXTERNAL_URL_REG = /^(?:https?:\/\/|mailto:)/i

const VAULT_ORIGIN = 'https://vault.local'

/** `https://vault.local/<segments>`, each segment encoded once (VaultRequestHandler decodes). */
export const toVaultUrl = (absolutePath: string): string =>
  VAULT_ORIGIN + absolutePath.split('/').map((part) => encodeURIComponent(part)).join('/')

export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  apng: 'image/apng'
}

/**
 * Browser dev build: no request interceptor exists, so images resolve to blob
 * URLs of the in-memory file, rebuilt when its mtime changes. A missing file
 * keeps the vault.local form, which does not resolve in a desktop browser.
 */
export function memoryImageUrlBuilder(backend: MemoryFileBackend): (absolutePath: string) => string {
  const cache = new Map<string, { mtimeMs: number; url: string }>()
  return (absolutePath) => {
    const file = backend.peek(absolutePath)
    const type = IMAGE_CONTENT_TYPES[absolutePath.slice(absolutePath.lastIndexOf('.') + 1).toLowerCase()]
    if (!file || !type) return toVaultUrl(absolutePath)
    const cached = cache.get(absolutePath)
    if (cached?.mtimeMs === file.mtimeMs) return cached.url
    if (cached) URL.revokeObjectURL(cached.url)
    const url = URL.createObjectURL(new Blob([file.data.slice()], { type }))
    cache.set(absolutePath, { mtimeMs: file.mtimeMs, url })
    return url
  }
}

export interface MiscOptions {
  isNative: boolean
  memoryBackend: MemoryFileBackend | null
}

async function openExternal(url: unknown, isNative: boolean): Promise<void> {
  if (typeof url !== 'string' || !EXTERNAL_URL_REG.test(url)) {
    console.warn('[shell] refused to open', url)
    return
  }
  if (isNative) await MtFs.openExternal({ url })
  else window.open(url, '_blank', 'noopener')
}

export function registerMisc({ isNative, memoryBackend }: MiscOptions): void {
  setLocalFileUrlBuilder(memoryBackend ? memoryImageUrlBuilder(memoryBackend) : toVaultUrl)

  ipcMain.handle('mt::win::is-fullscreen', () => false)
  ipcMain.handle('mt::win::is-maximized', () => false)
  for (const channel of NO_OP_SENDS) ipcMain.on(channel, () => {})
  // The settings window closes itself (settingsWindow.ts); the editor's close
  // button sends the app to the background, like the back button.
  ipcMain.on('mt::win::close', (event) => {
    if (event.sender.id === EDITOR_WINDOW_ID && isNative) {
      App.minimizeApp().catch((error: unknown) => console.error(error))
    }
  })

  ipcMain.handle('mt::clipboard::read-text', async() => {
    try {
      const { value } = await Clipboard.read()
      return value
    } catch {
      return ''
    }
  })
  ipcMain.on('mt::clipboard::write-text', (_event, text) => {
    Clipboard.write({ string: String(text) }).catch((error: unknown) => console.error('[clipboard]', error))
  })
  // @capacitor/clipboard puts images on the Android clipboard as data-URL
  // text, which other apps paste as a long string; answer "not copied".
  ipcMain.handle('mt::clipboard::write-image', () => false)

  ipcMain.handle('mt::shell::open-external', (_event, url) => openExternal(url, isNative))
  ipcMain.on('mt::shell::open-external', (_event, url) => {
    openExternal(url, isNative).catch((error: unknown) => console.error('[shell]', error))
  })

  ipcMain.on('mt::handle-renderer-error', (_event, error) => console.error('[renderer]', error))

  // electron-log's renderer transport forwards to `window.__electronLog`
  // (its preload); on Android the console is Logcat.
  Object.defineProperty(window, '__electronLog', {
    configurable: true,
    value: {
      sendToMain(message: { level?: string; data?: unknown[] }) {
        const data = Array.isArray(message?.data) ? message.data : [message]
        if (message?.level === 'error') console.error(...data)
        else if (message?.level === 'warn') console.warn(...data)
        else console.log(...data)
      }
    }
  })
}
