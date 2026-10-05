// Replaces the `electron` module for the Android web build (aliased in
// vite.web.config.ts). Only the surface the desktop preload imports exists
// here: the preload runs unchanged and exposes the same window globals.

import { connectWindowFromFrame } from '../main/frames'
import { rendererIpc, type RendererIpc } from '../main/ipc'

export type IpcRendererEvent = { sender: null }

// Electron types listener arguments and replies loosely; the preload's typed
// wrappers (keyed by @shared/types/ipc) pick the concrete shapes, so the shim
// lets the caller's context choose them through generics.
type Listener<A extends unknown[]> = (event: IpcRendererEvent, ...args: A) => void
type AnyListener = Parameters<RendererIpc['on']>[1]
// The registry stores listeners untyped; each was typed by its caller.
const erase = <A extends unknown[]>(listener: Listener<A>): AnyListener => listener as unknown as AnyListener

// A settings iframe talks to the main side of the top document.
const ipc: RendererIpc = connectWindowFromFrame() ?? rendererIpc

export const contextBridge = {
  // No isolated world on Android: the "main world" is the only world.
  exposeInMainWorld(key: string, api: unknown): void {
    Object.defineProperty(window, key, { value: api, configurable: false, enumerable: true, writable: false })
  }
}

export const ipcRenderer = {
  // Replies are produced by the handler registered for the same channel in
  // src/main, which the IPC contract types; the cast restores that link.
  invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => ipc.invoke(channel, ...args) as Promise<T>,
  send: (channel: string, ...args: unknown[]) => ipc.send(channel, ...args),
  sendSync: <T>(channel: string, ...args: unknown[]): T => ipc.sendSync(channel, ...args) as T,
  on: <A extends unknown[]>(channel: string, listener: Listener<A>) => {
    ipc.on(channel, erase(listener))
  },
  once: <A extends unknown[]>(channel: string, listener: Listener<A>) => {
    ipc.once(channel, erase(listener))
  },
  removeListener: <A extends unknown[]>(channel: string, listener: Listener<A>) => {
    ipc.removeListener(channel, erase(listener))
  },
  removeAllListeners: (channel: string) => {
    ipc.removeAllListeners(channel)
  }
}

// Chromium zoom levels are a 1.2 power scale; level 0 is 100%.
const ZOOM_STEP = 1.2

export const webFrame = {
  setZoomFactor(factor: number): void {
    document.documentElement.style.zoom = String(factor)
  },
  setZoomLevel(level: number): void {
    webFrame.setZoomFactor(Math.pow(ZOOM_STEP, level))
  }
}

export const webUtils = {
  // Files reach the WebView as blobs without a filesystem path (no drag and
  // drop from other apps); the share intent and pickers cover importing.
  getPathForFile: (_file: File): string => ''
}
