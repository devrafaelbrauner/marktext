// The editor window's main side (desktop main/windows/editor.ts, the file
// actions of main/menu/actions/file.ts and the file watcher). One window, so
// every editor push goes to window 1; dialogs are SAF pickers and the
// WebView's confirm box.

import { posix } from 'pathe'
import type { BufferedState } from '@shared/types/bufferedState'
import type { MarkdownDocument, SaveOptions, TabOptions, UnsavedFile } from '@shared/types/files'
import { isMobileFsError } from './fs/backend'
import { loadOptionsFrom, type CoreContext } from './context'
import { androidString, askUnsavedChanges } from './dialogs'
import { isRecord } from './guards'
import { translate } from './i18n'
import { EDITOR_WINDOW_ID, ipcMain, pushTo } from './ipc'
import type { Keybindings } from './keybindings'
import {
  getRecommendTitleFromMarkdownString,
  loadMarkdownFile,
  toWriteOptions,
  writeMarkdownFile
} from './markdownFile'
import { normalizeVirtualPath } from './scope'
import { getRootPath, setRootPath } from './state'
import { isMarkdownName, isViewableAsset, reportOutsideRoot } from './tree'

export const BUFFER_PATH = '/data/marktext/buffer.json'
/** How often open documents are checked for changes made by other apps. */
export const POLL_INTERVAL_MS = 5000

const MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream']

// Commands desktop binds as window accelerators that matter with a hardware
// keyboard; the accelerator itself comes from the keybinding map.
const KEYBOARD_COMMANDS: Array<[string, 'mt::editor-ask-file-save' | 'mt::editor-ask-file-save-as']> = [
  ['file.save', 'mt::editor-ask-file-save'],
  ['file.save-as', 'mt::editor-ask-file-save-as']
]

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'shift' | 'alt' | 'meta'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmdorctrl: 'ctrl',
  commandorcontrol: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta'
}

/** Whether `event` is the Electron accelerator `accelerator` (Linux semantics). */
export function matchesAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  const parts = accelerator.toLowerCase().split('+')
  const key = parts.pop()
  if (!key) return false
  const wanted = { ctrl: false, shift: false, alt: false, meta: false }
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part]
    if (!modifier) return false
    wanted[modifier] = true
  }
  return (
    event.key.toLowerCase() === key &&
    event.ctrlKey === wanted.ctrl &&
    event.shiftKey === wanted.shift &&
    event.altKey === wanted.alt &&
    event.metaKey === wanted.meta
  )
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
// IPC send handlers have no caller to reject to; failures end up in Logcat.
const logError = (error: unknown): void => console.error('[editor]', error)

interface OpenedFile {
  mtimeMs: number
  missing: boolean
}

export interface EditorWindowOptions {
  /** Folder opened at start when nothing else is (browser dev build demo vault). */
  demoFolder?: string
}

export class EditorWindow {
  private readonly push = pushTo(EDITOR_WINDOW_ID)
  /** Markdown documents open in tabs, with the mtime last read or written. */
  private readonly opened = new Map<string, OpenedFile>()
  private readonly saving = new Set<string>()
  private bootstrapped = false
  private polling = false
  private reports: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: CoreContext,
    private readonly keybindings: Keybindings,
    private readonly options: EditorWindowOptions = {}
  ) {}

  private get language(): string {
    const language = this.ctx.preferences.getItem('language')
    return typeof language === 'string' && language ? language : 'en'
  }

  register(): void {
    ipcMain.on('mt::ask-for-user-preference', (event) => {
      event.sender.send('mt::user-preference', this.ctx.preferences.getAll())
      // The renderer asks from the same synchronous block that registers its
      // `mt::bootstrap-editor` listener, so this is the first moment the
      // bootstrap cannot be dropped; it follows the preferences like on desktop.
      if (event.sender.id === EDITOR_WINDOW_ID && !this.bootstrapped) {
        this.bootstrapped = true
        this.startup().catch(logError)
      }
    })
    ipcMain.on('mt::open-file', (_event, filePath, options) => {
      this.openTab(filePath, isRecord(options) ? options : {}, true).catch(logError)
    })
    ipcMain.on('mt::open-file-by-window-id', (_event, _windowId, filePath, options) => {
      this.openTab(filePath, isRecord(options) ? options : {}, true).catch(logError)
    })
    ipcMain.on('mt::cmd-open-file', () => {
      this.pickAndOpenFile().catch(logError)
    })
    ipcMain.on('mt::cmd-open-folder', () => {
      this.pickAndOpenFolder().catch(logError)
    })
    ipcMain.on('mt::ask-for-open-project-in-sidebar', () => {
      this.pickAndOpenFolder().catch(logError)
    })
    ipcMain.on('mt::response-file-save', (_event, id, filename, pathname, markdown, options, defaultPath) => {
      this.save({ id, filename, pathname, markdown, options, defaultPath }).catch(logError)
    })
    ipcMain.on('mt::response-file-save-as', (_event, id, filename, pathname, markdown, options, defaultPath) => {
      this.saveAs({ id, filename, pathname, markdown, options, defaultPath }).catch(logError)
    })
    ipcMain.on('mt::save-tabs', (_event, tabs) => {
      this.saveTabs(tabs).catch(logError)
    })
    ipcMain.on('mt::save-and-close-tabs', (_event, tabs) => {
      this.saveAndCloseTabs(tabs).catch(logError)
    })
    ipcMain.on('mt::rename', (_event, payload) => {
      this.rename(payload.id, payload.pathname, payload.newPathname).catch(logError)
    })
    ipcMain.on('mt::response-file-move-to', (_event, payload) => {
      this.moveTo(payload.id, payload.pathname).catch(logError)
    })
    ipcMain.on('mt::window-tab-closed', (_event, pathname) => {
      this.opened.delete(pathname)
      this.ctx.scope.removeOpenedFile(pathname)
    })
    ipcMain.handle('update-buffer-state', async(_event, state) => {
      await this.ctx.backend.writeFile(BUFFER_PATH, JSON.stringify(state))
    })

    document.addEventListener('keydown', (event) => this.onKeydown(event), true)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkExternalChanges(true).catch(logError)
    })
    setInterval(() => {
      if (document.visibilityState === 'visible') this.checkExternalChanges(false).catch(logError)
    }, POLL_INTERVAL_MS)
  }

  /** Settles when every scheduled tree update ran (tests). */
  async idle(): Promise<void> {
    await this.reports
    await this.ctx.tree.idle()
  }

  // --- startup ---------------------------------

  async startup(): Promise<void> {
    const prefs = this.ctx.preferences
    const startUpAction = prefs.getItem('startUpAction')
    const buffer = startUpAction === 'restoreAll' ? await this.readBuffer() : null
    let folder: string | null = null
    if (!buffer) {
      const candidate =
        startUpAction === 'folder' ? prefs.getItem('defaultDirectoryToOpen') : prefs.getItem('lastOpenedFolder')
      // Desktop restoreAll without a buffer opens nothing; on Android the
      // last folder is the vault the user granted, so reopen it.
      if (typeof candidate === 'string' && candidate && (await this.isDirectory(candidate))) folder = candidate
      if (!folder && startUpAction !== 'blank') folder = this.options.demoFolder ?? null
    }
    const restoreLayout = prefs.getItem('restoreLayoutState') === true
    this.push('mt::bootstrap-editor', {
      addBlankTab: !buffer && !folder,
      markdownList: [],
      lineEnding: prefs.getPreferredEol(),
      sideBarVisibility: restoreLayout && prefs.getItem('sideBarVisibility') === true,
      tabBarVisibility: prefs.getItem('tabBarVisibility') === true,
      sourceCodeModeEnabled: prefs.getItem('sourceCodeModeEnabled') === true
    })
    if (buffer) await this.restoreAllState(buffer)
    else if (folder) await this.openFolder(folder)
  }

  private async readBuffer(): Promise<Record<string, unknown> | null> {
    try {
      if (!(await this.ctx.backend.stat(BUFFER_PATH))) return null
      const state: unknown = JSON.parse(await this.ctx.backend.readText(BUFFER_PATH))
      return isRecord(state) && Array.isArray(state.tabs) && state.tabs.length > 0 ? state : null
    } catch (error) {
      console.error('Failed to read the editor buffer state:', error)
      return null
    }
  }

  /** desktop _restoreAllState: reload saved tabs from disk, then hand the state to the renderer. */
  private async restoreAllState(state: Record<string, unknown>): Promise<void> {
    const project = isRecord(state.project) ? state.project : null
    const rootDirectory = project?.rootDirectory
    if (typeof rootDirectory === 'string' && rootDirectory) {
      if (await this.isDirectory(rootDirectory)) {
        await this.openFolder(rootDirectory)
      } else if (project) {
        // The grant is gone; a dead root would leave an empty sidebar.
        project.rootDirectory = null
      }
    }
    const tabs = Array.isArray(state.tabs) ? state.tabs : []
    for (const tab of tabs) {
      if (!isRecord(tab) || typeof tab.pathname !== 'string' || !tab.pathname || tab.kind === 'asset') continue
      const pathname = tab.pathname
      this.ctx.scope.addOpenedFile(pathname)
      try {
        const doc = await loadMarkdownFile(this.ctx.backend, pathname, loadOptionsFrom(this.ctx.preferences))
        // A buffer with unsaved edits wins over the file on disk.
        if (doc.markdown !== tab.markdown && tab.isSaved) tab.markdown = doc.markdown
        await this.track(pathname)
      } catch (error) {
        tab.isSaved = false
        this.push('mt::show-notification', {
          title: `Could not find file ${String(tab.filename)} on disk, please save your work.`,
          type: 'error',
          message: errorMessage(error)
        })
      }
    }
    // The renderer validates the snapshot it produced (createBufferedEditorState).
    this.push('mt::load-state', state as BufferedState)
  }

  // --- open ------------------------------------

  async openFolder(pathname: string): Promise<void> {
    if (!pathname || pathname === getRootPath()) return
    setRootPath(pathname)
    this.ctx.preferences.setItems({ lastOpenedFolder: pathname })
    this.push('mt::open-directory', pathname)
    await this.ctx.tree.open(pathname)
  }

  private async pickAndOpenFolder(): Promise<void> {
    try {
      const picked = await this.ctx.backend.pickDirectory()
      if (picked) await this.openFolder(picked.path)
    } catch (error) {
      this.notifyError('Cannot open folder', error)
    }
  }

  private async pickAndOpenFile(): Promise<void> {
    try {
      const picked = await this.ctx.backend.pickOpenFile(MARKDOWN_MIME_TYPES)
      if (!picked) return
      this.ctx.scope.grantFile(picked.path)
      await this.openTab(picked.path, {}, true)
    } catch (error) {
      this.notifyError('Cannot open tab', error)
    }
  }

  /** desktop openTabs for one file. */
  async openTab(filePath: unknown, options: TabOptions, selected: boolean): Promise<void> {
    const pathname = normalizeVirtualPath(filePath)
    try {
      if (!pathname || !this.ctx.scope.isAllowed(pathname)) {
        throw new Error(`Access to "${String(filePath)}" is not allowed.`)
      }
      if (isViewableAsset(pathname)) {
        // The renderer owns asset tabs and focuses an open one itself.
        this.ctx.scope.addOpenedFile(pathname)
        const subpath = typeof options.subpath === 'string' && options.subpath ? options.subpath : null
        this.push('mt::open-asset-tab', { pathname, subpath }, selected)
        return
      }
      if (this.opened.has(pathname)) {
        this.push('mt::switch-tab-by-file_path', pathname, options)
        return
      }
      const doc = await loadMarkdownFile(this.ctx.backend, pathname, loadOptionsFrom(this.ctx.preferences))
      this.ctx.scope.addOpenedFile(pathname)
      await this.track(pathname)
      // The shared type declares `encoding` as a string; desktop sends the
      // `{ encoding, isBom }` object the renderer reads (NEW_TAB_WITH_CONTENT).
      this.push('mt::open-new-tab', doc as unknown as MarkdownDocument, options, selected)
    } catch (error) {
      console.error(`[ERROR] Cannot open file or directory: ${errorMessage(error)}`)
      this.notifyError('Cannot open tab', error)
    }
  }

  // --- save ------------------------------------

  /** desktop handleResponseForSave; resolves the tab id once saved, `null` otherwise. */
  async save(file: UnsavedFile): Promise<string | null> {
    const { id, filename, markdown, options, defaultPath } = file
    const alreadyExistOnDisk = !!file.pathname
    let target = file.pathname ? normalizeVirtualPath(file.pathname) : null
    if (!target) {
      target = await this.pickSaveTarget(markdown, filename, defaultPath)
      if (!target) return null
    }
    if (!(await this.write(id, target, markdown, options))) return null
    if (alreadyExistOnDisk) {
      this.push('mt::tab-saved', id)
    } else {
      this.push('mt::set-pathname', { id, pathname: target, filename: posix.basename(target) })
    }
    return id
  }

  async saveAs(file: UnsavedFile): Promise<void> {
    const { id, filename, markdown, options, defaultPath } = file
    const oldPath = file.pathname ? normalizeVirtualPath(file.pathname) : null
    const target = await this.pickSaveTarget(markdown, filename, oldPath ? posix.dirname(oldPath) : defaultPath)
    if (!target || !(await this.write(id, target, markdown, options))) return
    if (oldPath && oldPath === target) {
      this.push('mt::tab-saved', id)
      return
    }
    if (oldPath) {
      this.opened.delete(oldPath)
      this.ctx.scope.removeOpenedFile(oldPath)
    }
    this.push('mt::set-pathname', { id, pathname: target, filename: posix.basename(target) })
  }

  private async pickSaveTarget(markdown: string, filename: string, defaultPath?: string): Promise<string | null> {
    const title = getRecommendTitleFromMarkdownString(markdown) || filename || 'Untitled'
    const suggested = /\.[^./]+$/.test(title) && isMarkdownName(title) ? title : `${title}.md`
    try {
      const initial = normalizeVirtualPath(defaultPath) ?? getRootPath() ?? undefined
      const picked = await this.ctx.backend.pickSaveFile(suggested, 'text/markdown', initial)
      if (!picked) return null
      this.ctx.scope.grantFile(picked.path)
      return picked.path
    } catch (error) {
      this.notifyError('Cannot save file', error)
      return null
    }
  }

  /** Writes and tracks the document; reports `mt::tab-save-failure` on error. */
  private async write(id: string, target: string, markdown: string, options: SaveOptions): Promise<boolean> {
    this.saving.add(target)
    try {
      if (!this.ctx.scope.isAllowed(target)) throw new Error(`Access to "${target}" is not allowed.`)
      const writeOptions = toWriteOptions(options, this.ctx.preferences.getPreferredEol())
      await writeMarkdownFile(this.ctx.backend, target, markdown, writeOptions)
      this.ctx.scope.addOpenedFile(target)
      await this.track(target)
      this.reportMutation([target])
      return true
    } catch (error) {
      console.error('Error while saving:', error)
      this.push('mt::tab-save-failure', id, errorMessage(error))
      return false
    } finally {
      this.saving.delete(target)
    }
  }

  private async saveTabs(tabs: unknown[]): Promise<void> {
    // One at a time: untitled tabs each open a picker.
    for (const tab of tabs) await this.save(tab as UnsavedFile)
  }

  private async saveAndCloseTabs(tabs: unknown[]): Promise<void> {
    // Renderer payload (help.ts getUnsavedFiles), the same shape desktop trusts.
    const files = tabs as UnsavedFile[]
    const choice = await askUnsavedChanges(this.language, files.map((file) => file.filename))
    if (choice === 'cancel') return
    if (choice === 'discard') {
      this.push('mt::force-close-tabs-by-id', files.map((file) => file.id))
      return
    }
    const saved: string[] = []
    for (const file of files) {
      const id = await this.save(file)
      if (id) saved.push(id)
    }
    this.push('mt::force-close-tabs-by-id', saved)
  }

  // --- rename / move ---------------------------

  async rename(id: string, pathname: string, newPathname: string): Promise<void> {
    const src = normalizeVirtualPath(pathname)
    const dest = normalizeVirtualPath(newPathname)
    if (!src || !dest || src === dest) return
    try {
      if (!this.ctx.scope.isAllowed(src) || !this.ctx.scope.isAllowed(dest)) {
        throw new Error(`Access to "${dest}" is not allowed.`)
      }
      if (await this.ctx.backend.stat(dest)) {
        const exists = await translate(this.language, 'dialog.fileExists', { filename: posix.basename(dest) })
        const replace = await translate(this.language, 'dialog.replace')
        if (!window.confirm(`${exists}\n${replace}?`)) return
        await this.ctx.backend.remove(dest)
      }
      await this.ctx.backend.rename(src, dest)
    } catch (error) {
      console.error(`mt::rename: Cannot rename "${src}" to "${dest}".`, error)
      this.notifyError('Cannot rename file', error)
      return
    }
    await this.moved(id, src, dest)
  }

  private async moveTo(id: string, pathname: string): Promise<void> {
    const src = normalizeVirtualPath(pathname)
    if (!src) return
    let dest: string | null = null
    try {
      const picked = await this.ctx.backend.pickSaveFile(posix.basename(src), 'text/markdown', posix.dirname(src))
      if (!picked || picked.path === src) return
      dest = picked.path
      this.ctx.scope.grantFile(dest)
      // The picker already created the target document, so a rename would
      // collide; copy over it and drop the source.
      await this.ctx.backend.copy(src, dest)
      await this.ctx.backend.remove(src)
    } catch (error) {
      console.error(`mt::response-file-move-to: Cannot move "${src}" to "${String(dest)}".`, error)
      this.notifyError('Cannot move file', error)
      return
    }
    await this.moved(id, src, dest)
  }

  private async moved(id: string, src: string, dest: string): Promise<void> {
    this.opened.delete(src)
    this.ctx.scope.removeOpenedFile(src)
    this.ctx.scope.addOpenedFile(dest)
    await this.track(dest)
    this.push('mt::set-pathname', { id, pathname: dest, filename: posix.basename(dest), oldPathname: src })
    this.reportMutation([src, dest])
  }

  // --- external changes ------------------------

  private async track(pathname: string): Promise<void> {
    const stat = await this.ctx.backend.stat(pathname)
    this.opened.set(pathname, { mtimeMs: stat?.mtimeMs ?? 0, missing: !stat })
  }

  /**
   * The file watcher's work by polling: open documents changed or removed by
   * another app push `mt::update-file`; with `includeTree` the open folder
   * is rescanned too (on return to the foreground).
   */
  async checkExternalChanges(includeTree: boolean): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      for (const [pathname, known] of [...this.opened]) {
        if (this.saving.has(pathname) || !isMarkdownName(pathname)) continue
        await this.checkFile(pathname, known)
      }
      if (includeTree) await this.ctx.tree.refresh()
    } finally {
      this.polling = false
    }
  }

  private async checkFile(pathname: string, known: OpenedFile): Promise<void> {
    let stat
    try {
      stat = await this.ctx.backend.stat(pathname)
    } catch (error) {
      if (!isMobileFsError(error, 'PERMISSION_DENIED')) throw error
      stat = null
    }
    if (!stat) {
      if (!known.missing) {
        known.missing = true
        this.push('mt::update-file', { type: 'unlink', change: { pathname } })
      }
      return
    }
    if (!known.missing && stat.mtimeMs === known.mtimeMs) return
    const type = known.missing ? 'add' : 'change'
    known.missing = false
    known.mtimeMs = stat.mtimeMs
    try {
      const data = await loadMarkdownFile(this.ctx.backend, pathname, loadOptionsFrom(this.ctx.preferences))
      this.push('mt::update-file', { type, change: { pathname, data, mtimeMs: stat.mtimeMs } })
    } catch (error) {
      this.push('mt::show-notification', { title: 'Watcher I/O error', type: 'error', message: errorMessage(error) })
    }
  }

  // --- helpers ---------------------------------

  /**
   * Tree and change-feed updates for app-made writes run after the current
   * IPC reply settled, like a watcher event: the sidebar creates a file, then
   * records its name, then expects the `add` (project.ts newFileNameCache).
   */
  reportMutation(paths: string[], withData = false): void {
    const run = async(): Promise<void> => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      await promise
      await this.ctx.tree.refresh(paths, withData)
      await reportOutsideRoot(this.ctx.backend, paths)
    }
    this.reports = this.reports.then(run).catch((error: unknown) => console.error('[editor] change report failed', error))
  }

  private async isDirectory(pathname: string): Promise<boolean> {
    try {
      return (await this.ctx.backend.stat(pathname))?.isDirectory === true
    } catch {
      return false
    }
  }

  private notifyError(title: string, error: unknown): void {
    this.push('mt::show-notification', { title, type: 'error', message: errorMessage(error) })
  }

  private onKeydown(event: KeyboardEvent): void {
    for (const [id, channel] of KEYBOARD_COMMANDS) {
      const accelerator = this.keybindings.keys.get(id)
      if (accelerator && matchesAccelerator(event, accelerator)) {
        event.preventDefault()
        this.push(channel)
        return
      }
    }
  }
}

/** Android has no trash: a sidebar delete asks, then removes permanently. */
export async function confirmAndDelete(ctx: CoreContext, language: string, pathname: string): Promise<boolean> {
  if (!window.confirm(androidString(language, 'deletePermanently', posix.basename(pathname)))) return false
  await ctx.backend.remove(pathname)
  return true
}
