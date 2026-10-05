import type {
  BacklinkEntry,
  FileMetadata,
  TagCount,
  VaultChangeEvent,
  VaultFileEntry
} from '@shared/plugins/types'

/** A folder watcher event (or save/rename notification) to apply to the index. */
export interface VaultFsChange {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  /** Absolute path. */
  path: string
}

/** File status as the index needs it; plain data so it can cross a message port. */
export interface VaultFileStats {
  isFile: boolean
  isDirectory: boolean
  size: number
  mtimeMs: number
  ctimeMs: number
}

/**
 * Disk access of the index worker. Desktop reads through Node (`nodeFs.ts`);
 * the Android build proxies to the WebView's file backend, so the index core
 * stays free of Node modules.
 */
export interface VaultIndexFs {
  /** Follows symlinks; null when nothing readable exists at `path`. */
  stat(path: string): Promise<VaultFileStats | null>
  /**
   * Absolute paths of the files below `dir`. Never descends into a folder
   * `isIgnored` accepts and never returns an ignored path; an unreadable
   * folder contributes nothing.
   */
  walk(dir: string, isIgnored: (path: string) => boolean): Promise<string[]>
  /** UTF-8 text; rejects when the file cannot be read. */
  readText(path: string): Promise<string>
  /** Replaces `path` atomically where possible, creating missing folders. */
  writeText(path: string, text: string): Promise<void>
}

/**
 * Read access to the in-memory index of one vault, handed to worker
 * handlers. Paths are absolute; results are snapshots the caller may keep.
 */
export interface VaultIndexReader {
  readonly rootPath: string
  getFile(path: string): FileMetadata | null
  /** Every indexed note, sorted by path. */
  listFiles(): FileMetadata[]
  /** Every non-markdown file (link and embed targets), sorted by path. */
  listAssets(): VaultFileEntry[]
  resolveLink(target: string, sourcePath: string): string | null
  getBacklinks(path: string): BacklinkEntry[]
  getTags(): TagCount[]
  getFilesWithTag(tag: string, options?: { includeNested?: boolean }): string[]
}

/** Persisted form of an index (`<userData>/vault-index/<sha1(root)>.json`). */
export interface VaultIndexCache {
  version: number
  rootPath: string
  notes: Array<{ meta: FileMetadata; contexts: string[] }>
}

/** Index operations reachable over IPC, by method name and argument tuple. */
export interface VaultIndexQueries {
  getFile: { args: [path: string]; ret: FileMetadata | null }
  listFiles: { args: []; ret: FileMetadata[] }
  resolveLink: { args: [target: string, sourcePath: string]; ret: string | null }
  getBacklinks: { args: [path: string]; ret: BacklinkEntry[] }
  getTags: { args: []; ret: TagCount[] }
  getFilesWithTag: { args: [tag: string, options?: { includeNested?: boolean }]; ret: string[] }
}

export type VaultIndexQueryMethod = keyof VaultIndexQueries

// Messages between VaultIndexManager (main) and the index utility process.

export type MainToWorkerMessage =
  | { kind: 'init'; rootPath: string; cacheFile: string | null; excludePatterns: string[] }
  | { kind: 'fs'; changes: VaultFsChange[] }
  | { kind: 'config'; excludePatterns: string[] }
  | { kind: 'query'; id: number; method: VaultIndexQueryMethod; args: unknown[] }
  | { kind: 'request'; id: number; type: string; payload: unknown }
  | { kind: 'dispose' }

export type WorkerToMainMessage =
  | { kind: 'ready' }
  | { kind: 'changed'; event: VaultChangeEvent }
  | { kind: 'reply'; id: number; ok: true; value: unknown }
  | { kind: 'reply'; id: number; ok: false; error: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { kind: 'disposed' }
