// File access contract of the Android main side. Paths are absolute POSIX
// strings, as the desktop renderer expects (`window.path` is pathe):
//
//   /data/marktext/...      app-private storage (settings, caches, buffers)
//   /vault/<key>/<name>/... a document tree the user granted through the
//                           Storage Access Framework picker; <key> is a short
//                           hash of the tree URI, stable for the lifetime of
//                           the grant, and <name> the tree's display name, so
//                           the sidebar shows the folder's own name
//   /doc/<key>/<name>       a single document opened or created via a picker
//
// The native plugin maps them onto File / DocumentFile; the memory backend
// backs unit tests and the browser dev build.

export type MobileFsErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'ENOTEMPTY'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED_ON_ANDROID'
  | 'EIO'

export class MobileFsError extends Error {
  readonly code: MobileFsErrorCode
  readonly path: string

  constructor(code: MobileFsErrorCode, path: string, message?: string) {
    super(message ?? `${code}: ${path}`)
    this.name = 'MobileFsError'
    this.code = code
    this.path = path
  }
}

export const isMobileFsError = (error: unknown, code?: MobileFsErrorCode): error is MobileFsError =>
  error instanceof MobileFsError && (code === undefined || error.code === code)

export interface FileStat {
  isFile: boolean
  isDirectory: boolean
  size: number
  mtimeMs: number
  birthtimeMs: number
}

export interface DirEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  /** Set when the listing carries it, which saves a stat per entry. */
  mtimeMs?: number
  birthtimeMs?: number
}

export interface PickedEntry {
  /** Virtual path (see header). */
  path: string
  /** Display name the provider reports. */
  name: string
}

/**
 * Every method rejects with `MobileFsError`; a revoked or missing grant is
 * `PERMISSION_DENIED`, never a raw platform exception.
 */
export interface FileBackend {
  /** `null` when nothing exists at `path`. */
  stat(path: string): Promise<FileStat | null>
  readdir(path: string): Promise<DirEntry[]>
  readFile(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  /** Creates missing parents. Replaces atomically when the provider allows it. */
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  mkdirp(path: string): Promise<void>
  /** Fails with EEXIST when `to` exists. */
  rename(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  /** Recursive for directories. */
  remove(path: string): Promise<void>

  /** Storage Access Framework pickers; `null` when the user cancels. */
  pickDirectory(): Promise<PickedEntry | null>
  pickOpenFile(mimeTypes: string[]): Promise<PickedEntry | null>
  /** `initialPath`: directory the picker should start in, when the provider allows it. */
  pickSaveFile(suggestedName: string, mimeType: string, initialPath?: string): Promise<PickedEntry | null>
}

/** Depth-first walk yielding file paths below `root` that `include` accepts. */
export async function walkFiles(
  backend: FileBackend,
  root: string,
  include: (path: string) => boolean,
  skipDir: (name: string) => boolean = (name) => name.startsWith('.') || name === 'node_modules'
): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: DirEntry[]
    try {
      entries = await backend.readdir(dir)
    } catch (error) {
      // A directory removed or revoked mid-walk drops out of the result.
      if (isMobileFsError(error, 'ENOENT') || isMobileFsError(error, 'PERMISSION_DENIED')) continue
      throw error
    }
    for (const entry of entries) {
      const child = dir.endsWith('/') ? dir + entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory) {
        if (!skipDir(entry.name)) stack.push(child)
      } else if (entry.isFile && include(child)) {
        out.push(child)
      }
    }
  }
  return out.sort()
}
