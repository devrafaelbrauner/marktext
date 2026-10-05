// In-WebView stand-in for Electron's main-process IPC. The desktop preload
// talks to this through the `electron` shim (src/shim/electron.ts), so the
// renderer keeps calling the same `mt::*` channels it calls on desktop.
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

/** Stand-in for `IpcMainInvokeEvent`; there is one window, so `sender` is it. */
export interface MobileIpcEvent {
  sender: { send: typeof push }
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
type RendererListener = (event: { sender: null }, ...args: unknown[]) => void

const invokeHandlers = new Map<string, AnyHandler>()
const syncHandlers = new Map<string, AnyHandler>()
const sendHandlers = new Map<string, Set<AnyHandler>>()
const rendererListeners = new Map<string, Set<RendererListener>>()
const warnedSends = new Set<string>()

const clone = <T>(value: T): T => structuredClone(value)

/** Pushes `channel` to the renderer, like `webContents.send`. */
export function push<K extends keyof IpcMainEventChannels>(
  channel: K,
  ...args: IpcMainEventChannels[K]
): void {
  const listeners = rendererListeners.get(channel)
  if (!listeners || listeners.size === 0) return
  const payload = clone(args) as unknown[]
  // Electron delivers pushes as a later task, never inside the caller's stack.
  queueMicrotask(() => {
    for (const listener of [...listeners]) listener({ sender: null }, ...payload)
  })
}

const mainEvent: MobileIpcEvent = { sender: { send: push } }

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

/** Renderer side, wrapped by the `electron` shim's `ipcRenderer`. */
export const rendererIpc = {
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = invokeHandlers.get(channel)
    if (!handler) {
      // Same rejection Electron gives for a channel nobody handles.
      throw new Error(`Error invoking remote method '${channel}': Error: No handler registered for '${channel}'`)
    }
    const result = await handler(mainEvent, ...clone(args))
    return clone(result)
  },
  send(channel: string, ...args: unknown[]): void {
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
      for (const handler of [...handlers]) handler(mainEvent, ...payload)
    })
  },
  sendSync(channel: string, ...args: unknown[]): unknown {
    const handler = syncHandlers.get(channel)
    if (!handler) throw new Error(`No sync handler registered for '${channel}'`)
    return clone(handler(mainEvent, ...clone(args)))
  },
  on(channel: string, listener: RendererListener): void {
    let set = rendererListeners.get(channel)
    if (!set) rendererListeners.set(channel, (set = new Set()))
    set.add(listener)
  },
  once(channel: string, listener: RendererListener): void {
    const wrapped: RendererListener = (event, ...args) => {
      rendererListeners.get(channel)?.delete(wrapped)
      onceOriginals.delete(wrapped)
      listener(event, ...args)
    }
    onceOriginals.set(wrapped, listener)
    rendererIpc.on(channel, wrapped)
  },
  removeListener(channel: string, listener: RendererListener): void {
    const set = rendererListeners.get(channel)
    if (!set) return
    if (set.delete(listener)) return
    for (const candidate of set) {
      if (onceOriginals.get(candidate) === listener) {
        set.delete(candidate)
        onceOriginals.delete(candidate)
        return
      }
    }
  },
  removeAllListeners(channel: string): void {
    rendererListeners.delete(channel)
  }
}

const onceOriginals = new Map<RendererListener, RendererListener>()

/** Channels with a registered invoke handler; feeds BRIDGE.md coverage checks. */
export const registeredInvokeChannels = (): string[] => [...invokeHandlers.keys()]
export const registeredSendChannels = (): string[] => [...sendHandlers.keys()]
