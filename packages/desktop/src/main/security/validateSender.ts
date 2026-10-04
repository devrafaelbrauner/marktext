import path from 'path'
import { pathToFileURL } from 'url'
import { BrowserWindow } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

/**
 * URL the app's own renderer is loaded from: the electron-vite dev server in
 * development, the packaged `renderer/index.html` otherwise. Mirrors
 * `BaseWindow._buildUrlWithSettings`.
 */
export const getAppRendererUrl = (): string | null => {
  if (import.meta.env.DEV) return process.env['ELECTRON_RENDERER_URL'] || null
  return pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
}

/**
 * Whether `candidate` is the app renderer page `base`. Query and hash are
 * ignored (windows carry their boot settings in the query); for `file:` the
 * exact page must match, for the dev server the origin is enough because
 * Vite serves every module from it.
 */
export const isAppRendererUrl = (candidate: string, base: string | null): boolean => {
  if (!base) return false
  let actual: URL
  let expected: URL
  try {
    actual = new URL(candidate)
    expected = new URL(base)
  } catch {
    return false
  }
  if (actual.protocol !== expected.protocol) return false
  if (expected.protocol === 'file:') {
    return actual.host === expected.host &&
      decodeURIComponent(actual.pathname) === decodeURIComponent(expected.pathname)
  }
  if (expected.protocol !== 'http:' && expected.protocol !== 'https:') return false
  return actual.origin === expected.origin
}

/**
 * True only when the IPC message comes from the top frame of an app
 * BrowserWindow showing the app renderer — not from an iframe (e.g. rendered
 * document HTML), a navigated-away page or a foreign webContents.
 */
export const validateSender = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  const frame = event?.senderFrame
  if (!frame || !event.sender) return false
  if (frame.parent !== null || frame !== frame.top) return false
  if (!BrowserWindow.fromWebContents(event.sender)) return false
  return isAppRendererUrl(frame.url, getAppRendererUrl())
}
