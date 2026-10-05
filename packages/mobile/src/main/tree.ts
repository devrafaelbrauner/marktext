// Sidebar tree of the open folder and the app's file change feed. Desktop
// gets both from chokidar (main/filesystem/watcher.ts): an initial scan, then
// an event per change. SAF has no change notifications, so here a subtree is
// diffed against the last known snapshot:
//
// - once when a folder opens (every entry is new → the initial scan);
// - after each mutation the app makes (sidebar create/rename/paste/delete,
//   save), scoped to the touched paths;
// - when the app returns to the foreground (changes made by other apps).
//
// Each difference becomes an `mt::update-object-tree` push in the watcher's
// payload shape and an `fsChanged` signal. Like the watcher, only markdown
// and viewable-asset files are listed; unlike it, hidden and node_modules
// folders are skipped (walking .git over SAF costs seconds).

import { posix } from 'pathe'
import { MARKDOWN_EXTENSIONS, VIEWABLE_ASSET_EXTENSIONS } from 'common/filesystem/extensions'
import { isMobileFsError, type FileBackend, type FileStat } from './fs/backend'
import { loadMarkdownFile, type LoadOptions, type MarkdownDocumentRaw } from './markdownFile'
import { isInside } from './scope'
import { fsChanged, getRootPath, type FsChange } from './state'
import { push } from './ipc'

interface Entry {
  isDirectory: boolean
  mtimeMs: number
}

interface FileAddChange {
  pathname: string
  name: string
  isFile: true
  isDirectory: false
  birthTime: Date
  mtimeMs: number
  isMarkdown: boolean
  data?: MarkdownDocumentRaw
}

interface DirAddChange {
  pathname: string
  name: string
  isCollapsed: true
  isDirectory: true
  isFile: false
  isMarkdown: false
  folders: []
  files: []
}

export type TreeEvent =
  | { type: 'add'; change: FileAddChange }
  | { type: 'addDir'; change: DirAddChange }
  | { type: 'change'; change: { pathname: string; mtimeMs: number } }
  | { type: 'unlink' | 'unlinkDir'; change: { pathname: string } }

export const isMarkdownName = (name: string): boolean =>
  MARKDOWN_EXTENSIONS.includes(posix.extname(name).slice(1).toLowerCase())

/** Non-markdown files an in-app tab view shows (common/filesystem hasViewableAssetExtension). */
export const isViewableAsset = (name: string): boolean =>
  VIEWABLE_ASSET_EXTENSIONS.includes(posix.extname(name).slice(1).toLowerCase())

/** Files the sidebar lists (watcher `ignored`). */
export const isListedFile = (name: string): boolean => isMarkdownName(name) || isViewableAsset(name)

const isSkippedDir = (name: string): boolean => name.startsWith('.') || name === 'node_modules' || name.endsWith('.asar')

type Seen = Pick<FileStat, 'isDirectory' | 'mtimeMs' | 'birthtimeMs'>

export interface TreeSyncOptions {
  backend: FileBackend
  loadOptions: () => LoadOptions
}

export class TreeSync {
  private snapshot = new Map<string, Entry>()
  private root: string | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: TreeSyncOptions) {}

  get rootPath(): string | null {
    return this.root
  }

  /** Starts tracking `root`; resolves after its initial events went out. */
  open(root: string): Promise<void> {
    this.root = root
    this.snapshot = new Map([[root, { isDirectory: true, mtimeMs: 0 }]])
    return this.enqueue(async() => {
      if (this.root === root) await this.diffChildren(root, false)
    })
  }

  close(): void {
    this.root = null
    this.snapshot = new Map()
  }

  /**
   * Rescans the subtree at each of `paths` (the whole folder when omitted).
   * `withData` attaches the document to markdown `add` events, as the
   * watcher does for files the user just created.
   */
  refresh(paths?: string[], withData = false): Promise<void> {
    return this.enqueue(async() => {
      const root = this.root
      if (!root) return
      for (const path of paths ?? [root]) {
        if (path === root) await this.diffChildren(root, withData)
        else if (isInside(root, path)) await this.diffPath(path, withData)
      }
    })
  }

  /** Settles once every queued scan finished. */
  idle(): Promise<void> {
    return this.queue
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((error: unknown) => console.error('[tree] scan failed', error))
    return this.queue
  }

  /** A path below the root whose state is unknown: stat it, then visit it. */
  private async diffPath(path: string, withData: boolean): Promise<void> {
    const parent = posix.dirname(path)
    // Below a folder the tree does not know yet: start from that folder.
    if (parent !== this.root && !this.snapshot.get(parent)?.isDirectory) return this.diffPath(parent, withData)
    let stat: FileStat | null
    try {
      stat = await this.options.backend.stat(path)
    } catch (error) {
      if (!isMobileFsError(error, 'PERMISSION_DENIED')) throw error
      stat = null
    }
    if (!stat) {
      this.removeSubtree(path)
      return
    }
    await this.visit(path, stat, withData)
  }

  private async diffChildren(dir: string, withData: boolean): Promise<void> {
    let entries
    try {
      entries = await this.options.backend.readdir(dir)
    } catch (error) {
      if (!isMobileFsError(error, 'ENOENT') && !isMobileFsError(error, 'PERMISSION_DENIED')) throw error
      if (dir !== this.root) this.removeSubtree(dir)
      return
    }
    const present = new Map<string, (typeof entries)[number]>()
    for (const entry of entries) {
      if (entry.isDirectory ? isSkippedDir(entry.name) : !isListedFile(entry.name)) continue
      present.set(`${dir}/${entry.name}`, entry)
    }
    for (const path of [...this.snapshot.keys()]) {
      if (path !== dir && posix.dirname(path) === dir && !present.has(path)) this.removeSubtree(path)
    }
    // Parent-first: a folder's addDir precedes everything inside it.
    for (const [path, entry] of [...present].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (entry.mtimeMs === undefined) {
        await this.diffPath(path, withData)
      } else {
        const mtimeMs = entry.mtimeMs
        await this.visit(path, { isDirectory: entry.isDirectory, mtimeMs, birthtimeMs: entry.birthtimeMs ?? mtimeMs }, withData)
      }
    }
  }

  private async visit(path: string, seen: Seen, withData: boolean): Promise<void> {
    const name = posix.basename(path)
    const known = this.snapshot.get(path)
    if (known && known.isDirectory !== seen.isDirectory) this.removeSubtree(path)
    if (seen.isDirectory) {
      if (isSkippedDir(name)) return
      if (!this.snapshot.has(path)) {
        this.snapshot.set(path, { isDirectory: true, mtimeMs: seen.mtimeMs })
        this.emit({
          type: 'addDir',
          change: { pathname: path, name, isCollapsed: true, isDirectory: true, isFile: false, isMarkdown: false, folders: [], files: [] }
        })
      }
      await this.diffChildren(path, withData)
      return
    }
    if (!isListedFile(name)) return
    const previous = this.snapshot.get(path)
    if (previous && previous.mtimeMs === seen.mtimeMs) return
    this.snapshot.set(path, { isDirectory: false, mtimeMs: seen.mtimeMs })
    if (previous) {
      this.emit({ type: 'change', change: { pathname: path, mtimeMs: seen.mtimeMs } })
      return
    }
    const isMarkdown = isMarkdownName(name)
    const change: FileAddChange = {
      pathname: path,
      name,
      isFile: true,
      isDirectory: false,
      birthTime: new Date(seen.birthtimeMs),
      mtimeMs: seen.mtimeMs,
      isMarkdown
    }
    // The renderer opens a file it just created from the sidebar with `data`
    // (project.ts newFileNameCache); scans of existing files skip the read.
    if (withData && isMarkdown) {
      try {
        change.data = await loadMarkdownFile(this.options.backend, path, this.options.loadOptions())
      } catch (error) {
        console.error(`[tree] cannot read ${path}`, error)
      }
    }
    this.emit({ type: 'add', change })
  }

  /** Unlinks `path` and everything known below it, deepest first. */
  private removeSubtree(path: string): void {
    const doomed = [...this.snapshot.keys()].filter((key) => isInside(path, key))
    doomed.sort((a, b) => b.split('/').length - a.split('/').length)
    for (const key of doomed) {
      const entry = this.snapshot.get(key)
      this.snapshot.delete(key)
      this.emit({ type: entry?.isDirectory ? 'unlinkDir' : 'unlink', change: { pathname: key } })
    }
  }

  private emit(event: TreeEvent): void {
    push('mt::update-object-tree', event)
    const change: FsChange =
      event.type === 'add' || event.type === 'change'
        ? { type: event.type, pathname: event.change.pathname, mtimeMs: event.change.mtimeMs }
        : { type: event.type, pathname: event.change.pathname }
    fsChanged.emit(change)
  }
}

/**
 * Reports app-made changes outside the open folder (saves of picked
 * documents) to `fsChanged`; changes inside it go through the tree diff so
 * the sidebar and the feed agree.
 */
export async function reportOutsideRoot(backend: FileBackend, paths: string[]): Promise<void> {
  const root = getRootPath()
  for (const path of paths) {
    if (root && isInside(root, path)) continue
    const stat = await backend.stat(path).catch(() => null)
    if (!stat) fsChanged.emit({ type: 'unlink', pathname: path })
    else if (stat.isDirectory) fsChanged.emit({ type: 'addDir', pathname: path })
    else fsChanged.emit({ type: 'change', pathname: path, mtimeMs: stat.mtimeMs })
  }
}
