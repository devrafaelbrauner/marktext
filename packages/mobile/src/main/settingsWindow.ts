// The desktop settings window, on Android: a full-screen iframe over the
// editor loading the same bundle as window 2. Its IPC is bridged to this
// document's main side (src/main/frames.ts), so preference changes reach the
// editor through the same `mt::user-preference` broadcast as on desktop.

import { USER_DATA_PATH } from './boot'
import { pushBackHandler } from './backButton'
import { SETTINGS_WINDOW_ID, disposeWindow, ipcMain } from './ipc'

let overlay: HTMLDivElement | null = null
let removeBackHandler: (() => void) | null = null

/**
 * `category` follows the desktop settings window `type`: '' for General,
 * 'spelling', 'plugins' or 'plugins/<plugin id>' (renderer router
 * parseSettingsPage).
 */
export function openSettingsWindow(category = ''): void {
  const type = category ? `settings/${category}` : 'settings'
  const params = new URLSearchParams({ wid: String(SETTINGS_WINDOW_ID), udp: USER_DATA_PATH, type })
  // Same first paint as the editor (core.ts keeps `theme` in the boot URL).
  const theme = new URLSearchParams(window.location.search).get('theme')
  if (theme) params.set('theme', theme)
  const src = `${window.location.pathname}?${params}`
  if (overlay) {
    // Desktop focuses the open settings window on the requested page.
    disposeWindow(SETTINGS_WINDOW_ID)
    overlay.querySelector('iframe')?.setAttribute('src', src)
    return
  }
  overlay = document.createElement('div')
  overlay.className = 'mt-settings-window'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:3000;background:var(--editorBgColor, #fff)'
  const frame = document.createElement('iframe')
  frame.title = document.title
  frame.style.cssText = 'border:0;width:100%;height:100%;display:block'
  frame.src = src
  overlay.append(frame)
  document.body.append(overlay)
  removeBackHandler = pushBackHandler(closeSettingsWindow)
}

export function closeSettingsWindow(): void {
  if (!overlay) return
  removeBackHandler?.()
  removeBackHandler = null
  disposeWindow(SETTINGS_WINDOW_ID)
  overlay.remove()
  overlay = null
}

export const isSettingsWindowOpen = (): boolean => overlay !== null

export function registerSettingsWindow(): void {
  ipcMain.on('mt::open-setting-window', () => openSettingsWindow())
  // The settings title bar closes its own window; the editor's close button
  // has a different meaning on Android and is handled with the editor.
  ipcMain.on('mt::win::close', (event) => {
    if (event.sender.id === SETTINGS_WINDOW_ID) closeSettingsWindow()
  })
}
