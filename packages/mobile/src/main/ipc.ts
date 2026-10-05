// In-WebView stand-in for Electron's main-process IPC. The desktop preload
// talks to this through the `electron` shim (src/shim/electron.ts), so the
// renderer keeps calling the same `mt::*` channels it calls on desktop.
//
// Windows: the editor is window 1 in the top document; the settings view is
// window 2, a same-origin iframe (src/main/settingsWindow.ts) whose shim
// connects to this registry instead of running its own main side.
//
// Arguments and results are structured-cloned like Electron does, so state
// shared by reference on Android would surface the same DataCloneError (for
// example a Vue proxy) that the desktop build throws.

import type {
  IpcInvokeChannels,
  IpcMainEventChannels,
  IpcSendChannels,
  IpcSyncChannels
} from '@shared/types/ipc'

export const EDITOR_WINDOW_ID = 1
export const SETTINGS_WINDOW_ID = 2

type PushFn = <K extends keyof IpcMainEventChannels>(channel: K, ...args: IpcMainEventChannels[K]) => void

/** Stand-in for `IpcMainInvokeEvent`: `sender` is the calling window. */
export interface MobileIpcEvent {
  sender: { id: number; send: PushFn }
}

type InvokeHandler<K extends keyof IpcInvokeChannels> = (
  event: MobileIpcEvent,
  ...args: IpcInvokeChannels[K]['args']
) => IpcInvokeChannels[K]['ret'] | Promise<IpcInvokeChannels[K]['ret']>

type SyncHandler<K extends keyof IpcSyncChannels> = (
  event: MobileIpcEvent,
  ...args: IpcSyncChannels[K]['args']
) => IpcSyncChannels[K]['ret']

type SendHandler<K extends keyof IpcSendChannels> = (
  event: MobileIpcEvent,
  ...args: IpcSendChannels[K]
) => void

type AnyHandler = (event: MobileIpcEvent, ...args: unknown[]) => unknown
export type RendererListener = (event: { sender: null }, ...args: unknown[]) => void

interface Registration {
  windowId: number
  listener: RendererListener
}

const invokeHandlers = new Map<string, AnyHandler>()
const syncHandlers = new Map<string, AnyHandler>()
const sendHandlers = new Map<string, Set<AnyHandler>>()
const rendererListeners = new Map<string, Set<Registration>>()
const warnedSends = new Set<string>()

const clone = <T>(value: T): T => structuredClone(value)

function deliver(channel: string, args: unknown[], windowId: number | null): void {
  const registrations = rendererListeners.get(channel)
  if (!registrations || registrations.size === 0) return
  const targets = [...registrations].filter((r) => windowId === null || r.windowId === windowId)
  if (targets.length === 0) return
  const payload = clone(args)
  // Electron delivers pushes as a later task, never inside the caller's stack.
  queueMicrotask(() => {
    for (const target of targets) {
      // A listener removed by an earlier one in this batch must not run.
      if (registrations.has(target)) target.listener({ sender: null }, ...payload)
    }
  })
}

/** Pushes `channel` to every window, like a `webContents.send` broadcast. */
export const push: PushFn = (channel, ...args) => deliver(channel, args, null)

/** Pushes `channel` to one window only. */
export const pushTo =
  (windowId: number): PushFn =>
    (channel, ...args) =>
      deliver(channel, args, windowId)

const eventFor = (windowId: number): MobileIpcEvent => ({ sender: { id: windowId, send: pushTo(windowId) } })

export const ipcMain = {
  handle<K extends keyof IpcInvokeChannels>(channel: K, handler: InvokeHandler<K>): void {
    if (invokeHandlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`)
    }
    invokeHandlers.set(channel, handler as unknown as AnyHandler)
  },
  handleSync<K extends keyof IpcSyncChannels>(channel: K, handler: SyncHandler<K>): void {
    syncHandlers.set(channel, handler as unknown as AnyHandler)
  },
  on<K extends keyof IpcSendChannels>(channel: K, handler: SendHandler<K>): void {
    let set = sendHandlers.get(channel)
    if (!set) sendHandlers.set(channel, (set = new Set()))
    set.add(handler as unknown as AnyHandler)
  },
  removeHandler(channel: keyof IpcInvokeChannels): void {
    invokeHandlers.delete(channel)
  }
}

export interface RendererIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  sendSync(channel: string, ...args: unknown[]): unknown
  on(channel: string, listener: RendererListener): void
  once(channel: string, listener: RendererListener): void
  removeListener(channel: string, listener: RendererListener): void
  removeAllListeners(channel: string): void
}

/** The renderer side of one window, wrapped by that window's `electron` shim. */
export function connectWindow(windowId: number): RendererIpc {
  const event = eventFor(windowId)
  // `once` wrappers, so removeListener(original) can find them.
  const onceOriginals = new Map<RendererListener, RendererListener>()

  const find = (channel: string, listener: RendererListener): Registration | undefined => {
    for (const registration of rendererListeners.get(channel) ?? []) {
      if (registration.windowId !== windowId) continue
      if (registration.listener === listener || onceOriginals.get(registration.listener) === listener) {
        return registration
      }
    }
    return undefined
  }

  const ipc: RendererIpc = {
    async invoke(channel, ...args) {
      const handler = invokeHandlers.get(channel)
      if (!handler) {
        // Same rejection Electron gives for a channel nobody handles.
        throw new Error(`Error invoking remote method '${channel}': Error: No handler registered for '${channel}'`)
      }
      const result = await handler(event, ...clone(args))
      return clone(result)
    },
    send(channel, ...args) {
      const handlers = sendHandlers.get(channel)
      if (!handlers || handlers.size === 0) {
        // Electron drops unhandled sends silently; warn once so a missing
        // Android handler is visible in Logcat without flooding it.
        if (!warnedSends.has(channel)) {
          warnedSends.add(channel)
          console.warn(`[mobile-ipc] no handler for send '${channel}'`)
        }
        return
      }
      const payload = clone(args)
      queueMicrotask(() => {
        for (const handler of [...handlers]) handler(event, ...payload)
      })
    },
    sendSync(channel, ...args) {
      const handler = syncHandlers.get(channel)
      if (!handler) throw new Error(`No sync handler registered for '${channel}'`)
      return clone(handler(event, ...clone(args)))
    },
    on(channel, listener) {
      let set = rendererListeners.get(channel)
      if (!set) rendererListeners.set(channel, (set = new Set()))
      set.add({ windowId, listener })
    },
    once(channel, listener) {
      const wrapped: RendererListener = (e, ...args) => {
        ipc.removeListener(channel, wrapped)
        listener(e, ...args)
      }
      onceOriginals.set(wrapped, listener)
      ipc.on(channel, wrapped)
    },
    removeListener(channel, listener) {
      const registration = find(channel, listener)
      if (!registration) return
      rendererListeners.get(channel)?.delete(registration)
      onceOriginals.delete(registration.listener)
    },
    removeAllListeners(channel) {
      const set = rendererListeners.get(channel)
      if (!set) return
      for (const registration of [...set]) {
        if (registration.windowId === windowId) set.delete(registration)
      }
    }
  }
  return ipc
}

/** Drops every listener a closed window left behind. */
export function disposeWindow(windowId: number): void {
  for (const set of rendererListeners.values()) {
    for (const registration of [...set]) {
      if (registration.windowId === windowId) set.delete(registration)
    }
  }
}

/** The editor window, which lives in the top document with the main side. */
export const rendererIpc = connectWindow(EDITOR_WINDOW_ID)

/** Channels with a registered handler; feeds the BRIDGE.md coverage check. */
export const registeredInvokeChannels = (): string[] => [...invokeHandlers.keys()]
export const registeredSendChannels = (): string[] => [...sendHandlers.keys()]
export const registeredSyncChannels = (): string[] => [...syncHandlers.keys()]
