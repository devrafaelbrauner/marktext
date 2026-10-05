// Keybindings (desktop main/keyboard/shortcutHandler.ts). Desktop registers
// every accelerator on the BrowserWindow; Android has no main-side shortcuts,
// so the map only feeds the renderer (command palette, settings page) and the
// hardware keyboard hook of the editor window (save, save as).

import keybindingsLinux from '../../../desktop/src/main/keyboard/keybindingsLinux'
import type { FileBackend } from './fs/backend'
import { isRecord } from './guards'
import { ipcMain, push } from './ipc'

export const KEYBINDINGS_PATH = '/data/marktext/keybindings.json'

// common/keybinding reads `process.platform` at module load, before the
// preload has defined `process`; import it once the renderer is running.
const loadIsEqualAccelerator = async(): Promise<(a: string, b: string) => boolean> =>
  (await import('common/keybinding')).isEqualAccelerator

/**
 * shortcutHandler _loadLocalKeybindings: user entries override defaults, a
 * user accelerator unbinds the default command that used it, and duplicate
 * user accelerators reject the whole file. Accelerator syntax is not checked
 * (desktop uses electron-localshortcut); the settings page only produces
 * valid ones.
 */
export function mergeKeybindings(
  defaults: Map<string, string>,
  raw: unknown,
  isEqualAccelerator: (a: string, b: string) => boolean
): { keys: Map<string, string>; user: Map<string, string> } {
  const keys = new Map(defaults)
  const user = new Map<string, string>()
  if (!isRecord(raw)) return { keys, user }
  for (const [id, value] of Object.entries(raw)) {
    if (defaults.has(id) && typeof value === 'string') user.set(id, value)
  }
  for (const [idA, valueA] of user) {
    for (const [idB, valueB] of user) {
      if (valueA !== '' && idA !== idB && isEqualAccelerator(valueA, valueB)) {
        console.error(`Invalid keybindings.json configuration: Duplicate value for "${idA}" and "${idB}"!`)
        return { keys, user: new Map() }
      }
    }
  }
  for (const [id, accelerator] of user) {
    if (accelerator) {
      for (const [defaultId, defaultAccelerator] of keys) {
        if (isEqualAccelerator(defaultAccelerator, accelerator)) {
          keys.set(defaultId, '')
          if (!user.has(defaultId)) user.set(defaultId, '')
          break
        }
      }
    }
    keys.set(id, accelerator)
  }
  return { keys, user }
}

export class Keybindings {
  keys = new Map(keybindingsLinux)
  user = new Map<string, string>()

  constructor(private readonly backend: FileBackend) {}

  async load(): Promise<void> {
    let raw: unknown = null
    if (await this.backend.stat(KEYBINDINGS_PATH)) {
      try {
        raw = JSON.parse(await this.backend.readText(KEYBINDINGS_PATH))
      } catch (error) {
        console.warn('Invalid keybinding configuration: failed to load or parse file.', error)
      }
    }
    const merged = mergeKeybindings(keybindingsLinux, raw, await loadIsEqualAccelerator())
    this.keys = merged.keys
    this.user = merged.user
  }

  async save(user: unknown): Promise<boolean> {
    const entries = user instanceof Map ? Object.fromEntries(user) : isRecord(user) ? user : {}
    try {
      await this.backend.writeFile(KEYBINDINGS_PATH, JSON.stringify(entries, null, 2))
    } catch (error) {
      console.error('Cannot save keybindings', error)
      return false
    }
    await this.load()
    return true
  }
}

export function registerKeybindings(keybindings: Keybindings): void {
  // The keybinding file is loaded on the first request, which the renderer
  // makes 500 ms after mounting (see the module-load note above).
  let ready: Promise<void> | null = null
  const loaded = (): Promise<void> => (ready ??= keybindings.load())
  ipcMain.on('mt::request-keybindings', (event) => {
    loaded()
      .then(() => event.sender.send('mt::keybindings-response', Object.fromEntries(keybindings.keys)))
      .catch((error: unknown) => console.error('[keybindings]', error))
  })
  ipcMain.handle('mt::keybinding-get-pref-keybindings', async() => {
    await loaded()
    return { defaultKeybindings: new Map(keybindingsLinux), userKeybindings: new Map(keybindings.user) }
  })
  ipcMain.handle('mt::keybinding-save-user-keybindings', async(_event, user) => {
    await loaded()
    const saved = await keybindings.save(user)
    push('mt::keybindings-response', Object.fromEntries(keybindings.keys))
    return saved
  })
}
