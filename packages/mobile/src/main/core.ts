// Boot of the Android main side's core: file backend, preferences, i18n,
// keybindings, the editor window, `mt::fs::*` and the small channels. Runs
// after registerBoot (the boot URL exists) and before the renderer loads.

import { Capacitor } from '@capacitor/core'
import { USER_DATA_PATH } from './boot'
import { loadOptionsFrom, type CoreContext } from './context'
import { EditorWindow } from './editorWindow'
import { DEMO_VAULT_FILES, DEMO_VAULT_PATH } from './fs/demoVault'
import { MemoryFileBackend } from './fs/memoryBackend'
import { NativeFileBackend } from './fs/nativeBackend'
import { registerFsHandlers } from './fsHandlers'
import { registerI18n } from './i18n'
import { ipcMain, push } from './ipc'
import { Keybindings, registerKeybindings } from './keybindings'
import { registerMenus } from './menus'
import { registerMisc } from './misc'
import { Preferences, UserData } from './preferences'
import { PathScope } from './scope'
import { getRootPath, setBackend } from './state'
import { TreeSync } from './tree'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Preference channels (desktop preferences/index.ts, dataCenter, app/index.ts language and theme). */
function registerPreferenceChannels({ preferences, userData }: CoreContext): void {
  ipcMain.on('mt::ask-for-user-data', (event) => event.sender.send('mt::user-preference', userData.getAll()))
  ipcMain.on('mt::set-user-preference', (_event, partial) => preferences.setItems(partial))
  ipcMain.on('mt::set-user-data', (_event, partial) => userData.setItems(partial))
  ipcMain.on('mt::cmd-toggle-autosave', () => preferences.setItems({ autoSave: !preferences.getItem('autoSave') }))
  ipcMain.on('mt::get-current-language', (event) => {
    event.sender.send('mt::current-language', String(preferences.getItem('language') || 'en'))
  })

  const systemTheme = (): unknown =>
    window.matchMedia(DARK_QUERY).matches ? preferences.getItem('darkModeTheme') : preferences.getItem('lightModeTheme')

  preferences.onChange((change) => {
    // Desktop broadcasts every change except the title bar style, which only
    // applies to new windows.
    const { titleBarStyle: _titleBarStyle, ...broadcast } = change
    if (Object.keys(broadcast).length > 0) push('mt::user-preference', broadcast)
    if (typeof change.language === 'string') push('language-changed', change.language)
    // Following the system theme: turning it on, or changing the light/dark
    // pair while on, applies the matching theme right away.
    const following = preferences.getItem('followSystemTheme') === true
    if (change.followSystemTheme === true || (following && ('lightModeTheme' in change || 'darkModeTheme' in change))) {
      const theme = systemTheme()
      if (theme !== preferences.getItem('theme')) preferences.setItems({ theme })
    }
  })
  userData.onChange((change) => push('mt::user-preference', change))

  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (preferences.getItem('followSystemTheme') !== true) return
    const theme = systemTheme()
    if (theme !== preferences.getItem('theme')) preferences.setItems({ theme })
  })
}

export async function registerCore(): Promise<void> {
  const isNative = Capacitor.isNativePlatform()
  // The browser dev build has no native side: an in-memory demo vault.
  const memoryBackend = isNative ? null : new MemoryFileBackend(DEMO_VAULT_FILES)
  const backend = memoryBackend ?? new NativeFileBackend()
  setBackend(backend)

  const preferences = await Preferences.load(backend, {
    systemLanguage: navigator.language,
    systemDark: window.matchMedia(DARK_QUERY).matches
  })
  const userData = await UserData.load(backend, USER_DATA_PATH)
  const ctx: CoreContext = {
    backend,
    preferences,
    userData,
    scope: new PathScope({ userDataPath: USER_DATA_PATH, rootPath: getRootPath, userData: () => userData.getAll() }),
    tree: new TreeSync({ backend, loadOptions: () => loadOptionsFrom(preferences) }),
    userDataPath: USER_DATA_PATH
  }
  const keybindings = new Keybindings(backend)
  const editor = new EditorWindow(ctx, keybindings, { demoFolder: isNative ? undefined : DEMO_VAULT_PATH })

  registerPreferenceChannels(ctx)
  registerI18n()
  registerKeybindings(keybindings)
  editor.register()
  registerFsHandlers(ctx, editor)
  registerMisc({ isNative, memoryBackend })
  registerMenus(() => String(preferences.getItem('language') || 'en'))

  // The renderer paints its theme from the boot URL before the preferences
  // arrive (bootstrap.ts initialState); without it a dark theme flashes light.
  const url = new URL(window.location.href)
  url.searchParams.set('theme', String(preferences.getItem('theme')))
  window.history.replaceState(null, '', url)
}
