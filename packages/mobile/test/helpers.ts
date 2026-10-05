// Builds the Android main side over a MemoryFileBackend and records what it
// pushes to the editor window, so specs assert on the renderer-visible
// protocol instead of internals.

import type { CoreContext } from '../src/main/context'
import { loadOptionsFrom } from '../src/main/context'
import { EditorWindow } from '../src/main/editorWindow'
import { MemoryFileBackend } from '../src/main/fs/memoryBackend'
import { rendererIpc } from '../src/main/ipc'
import { Keybindings } from '../src/main/keybindings'
import { Preferences, UserData } from '../src/main/preferences'
import { PathScope } from '../src/main/scope'
import { getRootPath, setBackend, setRootPath } from '../src/main/state'
import { TreeSync } from '../src/main/tree'

export const ROOT = '/vault/abcd1234/Notes'

export type Pushed = [channel: string, ...args: unknown[]]

/** Every push on `channels`, in delivery order. */
export function recordPushes(channels: string[]): Pushed[] {
  const pushed: Pushed[] = []
  for (const channel of channels) rendererIpc.on(channel, (_event, ...args) => pushed.push([channel, ...args]))
  return pushed
}

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export async function createCore(files: Record<string, string> = {}, preferences: Record<string, unknown> = {}) {
  const backend = new MemoryFileBackend({
    '/data/marktext/preferences.json': JSON.stringify({ followSystemTheme: false, ...preferences }),
    ...files
  })
  setBackend(backend)
  setRootPath(null)
  const prefs = await Preferences.load(backend, { systemLanguage: 'en', systemDark: false })
  const userData = await UserData.load(backend, '/data/marktext')
  const ctx: CoreContext = {
    backend,
    preferences: prefs,
    userData,
    scope: new PathScope({ userDataPath: '/data/marktext', rootPath: getRootPath, userData: () => userData.getAll() }),
    tree: new TreeSync({ backend, loadOptions: () => loadOptionsFrom(prefs) }),
    userDataPath: '/data/marktext'
  }
  const editor = new EditorWindow(ctx, new Keybindings(backend))
  return { backend, ctx, editor }
}
