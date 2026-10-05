// Messages between the WebView main side (host.ts) and the index Web Worker
// (worker.ts). The desktop index protocol passes through unchanged; Android
// adds the file bridge (the worker cannot reach Capacitor), the resume
// rescan and the full-text search that replaces ripgrep.

import type {
  MainToWorkerMessage,
  VaultFileStats,
  WorkerToMainMessage
} from '../../../../desktop/src/main/vaultIndex/types'

/** `mt::rg::start` request as the renderer's ripgrepSearcher builds it. */
export interface SearchRequest {
  searchId: string
  mode: 'text' | 'files'
  directories: string[]
  pattern: string
  options: SearchOptions
}

/** The ripgrep options Android honours; the rest of the renderer's options are ignored. */
export interface SearchOptions {
  isRegexp?: boolean
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  /** ripgrep `--max-filesize` syntax: bytes with an optional K, M or G suffix. */
  maxFileSize?: number | string | null
  inclusions?: string[]
  exclusions?: string[]
  /** Stops after this many files with matches. */
  maxResults?: number
}

/** One `mt::rg::match` entry of a file in text mode (desktop `RgMatch`). */
export interface TextMatch {
  matchText: string
  lineText: string
  /** `[[row, column], [row, column]]`, zero-based, UTF-16 columns. */
  range: [[number, number], [number, number]]
  leadingContextLines: string[]
  trailingContextLines: string[]
}

export type SearchEvent =
  | { channel: 'match'; payload: { searchId: string; payload: { filePath: string; matches: TextMatch[] } | string } }
  | { channel: 'progress'; payload: { searchId: string; num: number } }
  | { channel: 'done' | 'cancelled'; payload: { searchId: string } }
  | { channel: 'error'; payload: { searchId: string; error: string } }

export interface WalkedFile {
  path: string
  mtimeMs: number
  size: number
}

export type FsCall =
  | { op: 'stat'; path: string }
  | { op: 'walk'; dir: string }
  | { op: 'walkStats'; dir: string }
  | { op: 'readText'; path: string }
  | { op: 'writeText'; path: string; text: string }

export interface FsResults {
  stat: VaultFileStats | null
  walk: string[]
  walkStats: WalkedFile[]
  readText: string
  writeText: null
}

export type HostToWorkerMessage =
  | MainToWorkerMessage
  | { kind: 'fs-reply'; id: number; ok: true; value: unknown }
  | { kind: 'fs-reply'; id: number; ok: false; error: string }
  /** Diff the folder against the index and apply what changed outside the app. */
  | { kind: 'rescan' }
  | { kind: 'search'; request: SearchRequest }
  | { kind: 'search-cancel'; searchId: string }

export type WorkerToHostMessage =
  | WorkerToMainMessage
  | { kind: 'fs-call'; id: number; call: FsCall }
  | { kind: 'search-event'; event: SearchEvent }
