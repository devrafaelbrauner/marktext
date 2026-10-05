// Window-level state the Android main side shares between its modules: the
// open folder, the focused document and file system changes made through the
// app. Desktop spreads this over EditorWindow, the watcher and the plugin
// host; on Android there is one window, so one module owns it.

import type { FileBackend } from './fs/backend'

export type FsChange =
  | { type: 'add' | 'change'; pathname: string; mtimeMs: number }
  | { type: 'unlink'; pathname: string }
  | { type: 'addDir' | 'unlinkDir'; pathname: string }

type Listener<T> = (value: T) => void

class Signal<T> {
  private readonly listeners = new Set<Listener<T>>()

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value)
  }
}

let backend: FileBackend | null = null
let rootPath: string | null = null
let activeFile: string | null = null

export const rootChanged = new Signal<string | null>()
export const activeFileChanged = new Signal<string | null>()
/** Every create/write/rename/delete the app performs, after it succeeded. */
export const fsChanged = new Signal<FsChange>()

export function setBackend(next: FileBackend): void {
  backend = next
}

export function getBackend(): FileBackend {
  if (!backend) throw new Error('FileBackend used before boot installed it')
  return backend
}

export const getRootPath = (): string | null => rootPath

export function setRootPath(next: string | null): void {
  if (next === rootPath) return
  rootPath = next
  rootChanged.emit(next)
}

export const getActiveFile = (): string | null => activeFile

export function setActiveFile(next: string | null): void {
  if (next === activeFile) return
  activeFile = next
  activeFileChanged.emit(next)
}
