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
