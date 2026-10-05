// Cross-frame link between the settings iframe and the main side running in
// the top document. Both documents share an origin, so the frame calls the
// top window's registry directly (sync IPC keeps working); every value that
// crosses is re-cloned in the receiving realm so Vue in the frame never sees
// objects whose prototypes belong to the other document.

import { connectWindow, type RendererIpc, type RendererListener } from './ipc'

interface MainHost {
  __mtMain?: { connectWindow: (windowId: number) => RendererIpc }
}

/** Lets same-origin frames reach this document's main side. */
export function exposeMainToFrames(): void {
  Object.defineProperty(window, '__mtMain', { value: { connectWindow }, configurable: false })
}

/** True in the settings iframe: the main side lives in the parent document. */
export const isChildFrame = (): boolean => window.parent !== window

/** The frame's renderer IPC bound to the parent's main side, else `null`. */
export function connectWindowFromFrame(): RendererIpc | null {
  if (!isChildFrame()) return null
  const host = (window.parent as unknown as MainHost).__mtMain
  if (!host) throw new Error('Settings frame loaded without a main side in the parent document')
  const windowId = Number(new URLSearchParams(window.location.search).get('wid'))
  return inThisRealm(host.connectWindow(windowId))
}

function inThisRealm(remote: RendererIpc): RendererIpc {
  // One wrapper per original listener so removeListener finds it again.
  const wrappers = new Map<RendererListener, RendererListener>()
  const wrap = (listener: RendererListener): RendererListener => {
    let wrapped = wrappers.get(listener)
    if (!wrapped) {
      wrapped = (event, ...args) => listener(event, ...structuredClone(args))
      wrappers.set(listener, wrapped)
    }
    return wrapped
  }
  return {
    invoke: async(channel, ...args) => structuredClone(await remote.invoke(channel, ...args)),
    send: (channel, ...args) => remote.send(channel, ...args),
    sendSync: (channel, ...args) => structuredClone(remote.sendSync(channel, ...args)),
    on: (channel, listener) => remote.on(channel, wrap(listener)),
    once: (channel, listener) => remote.once(channel, wrap(listener)),
    removeListener: (channel, listener) => remote.removeListener(channel, wrap(listener)),
    removeAllListeners: (channel) => remote.removeAllListeners(channel)
  }
}
