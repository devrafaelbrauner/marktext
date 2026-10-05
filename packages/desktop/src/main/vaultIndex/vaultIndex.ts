import path from 'path'
import { checkPathExcludePattern } from 'common/filesystem/excludePatterns'
import { hasMarkdownExtension } from 'common/filesystem/extensions'
import { createLinkResolver, getDailyNoteDate, parseNote, type LinkResolver } from 'common/markdownExt'
import type {
  BacklinkEntry,
  FileMetadata,
  TagCount,
  VaultChangeEvent,
  VaultFileEntry
} from '@shared/plugins/types'
import type { VaultFileStats, VaultIndexCache, VaultIndexFs, VaultFsChange, VaultIndexReader } from './types'

/** Bump whenever parser output changes so stale caches are re-parsed. */
export const VAULT_INDEX_CACHE_VERSION = 1

/** Markdown files larger than this are listed with empty metadata instead of parsed. */
const DEFAULT_MAX_PARSE_BYTES = 5 * 1024 * 1024
const READ_CONCURRENCY = 32

export interface VaultIndexOptions {
  /** Glob patterns of the `treePathExcludePatterns` preference (minimatch, matchBase). */
  excludePatterns?: readonly string[]
  maxParseBytes?: number
}

interface NoteRecord {
  meta: FileMetadata
  /** Vault-relative POSIX path. */
  rel: string
  /** Trimmed text of the line holding each link, parallel to `meta.links`. */
  contexts: string[]
}

interface AssetRecord {
  entry: VaultFileEntry
  rel: string
}

const toPosix = (p: string): string => p.split(path.sep).join('/')

const sameLinks = (a: FileMetadata['links'], b: FileMetadata['links']): boolean =>
  a.length === b.length && a.every((link, i) => link.resolved === b[i].resolved)

/**
 * In-memory metadata index of one folder ("vault"): parsed notes, the other
 * files (link targets), resolved links, backlinks and tags. Paths in and out
 * are absolute. Runs inside the index worker; every method is synchronous
 * except those touching the disk. Hidden entries (`.git`, `.obsidian`,
 * `.trash` …), `node_modules`, `*.asar` and the exclude patterns are ignored,
 * mirroring the folder watcher.
 */
export class VaultIndex implements VaultIndexReader {
  readonly rootPath: string
  private readonly _fs: VaultIndexFs
  private _excludePatterns: readonly string[]
  private readonly _maxParseBytes: number
  private _notes = new Map<string, NoteRecord>()
  private _assets = new Map<string, AssetRecord>()
  private _resolver: LinkResolver | null = null
  private _backlinks: Map<string, BacklinkEntry[]> | null = null
  private _tags: TagCount[] | null = null

  constructor(rootPath: string, fs: VaultIndexFs, options: VaultIndexOptions = {}) {
    this.rootPath = path.resolve(rootPath)
    this._fs = fs
    this._excludePatterns = options.excludePatterns ?? []
    this._maxParseBytes = options.maxParseBytes ?? DEFAULT_MAX_PARSE_BYTES
  }

  setExcludePatterns(patterns: readonly string[]): void {
    this._excludePatterns = patterns
  }

  /**
   * Whether `absPath` lies outside the vault or in an ignored location. Like
   * the watcher, which never descends into an excluded folder, a path is
   * ignored when it or any folder between it and the root is excluded.
   */
  isIgnored(absPath: string): boolean {
    const rel = path.relative(this.rootPath, absPath)
    if (!rel) return false
    if (rel.startsWith('..') || path.isAbsolute(rel)) return true
    let current = this.rootPath
    for (const segment of rel.split(path.sep)) {
      if (segment.startsWith('.') || segment === 'node_modules' || segment.endsWith('.asar')) return true
      current = path.join(current, segment)
      if (this._excludePatterns.length > 0 && checkPathExcludePattern(current, this._excludePatterns)) return true
    }
    return false
  }

  /**
   * Rebuilds the index from disk. Notes whose cached mtime and size still
   * match are taken from `cache` without re-reading. The previous state stays
   * queryable until the scan completes.
   */
  async scan(cache: VaultIndexCache | null = null): Promise<void> {
    const cached = new Map<string, VaultIndexCache['notes'][number]>()
    if (cache && cache.version === VAULT_INDEX_CACHE_VERSION && cache.rootPath === this.rootPath) {
      for (const note of cache.notes) cached.set(note.meta.path, note)
    }
    const files = await this._fs.walk(this.rootPath, (p) => this.isIgnored(p))
    const notes = new Map<string, NoteRecord>()
    const assets = new Map<string, AssetRecord>()
    await this._forEachConcurrent(files, async(file) => {
      const stats = await this._fs.stat(file)
      if (!stats?.isFile) return
      if (!hasMarkdownExtension(file)) {
        assets.set(file, this._assetRecord(file, stats))
        return
      }
      const hit = cached.get(file)
      if (hit && hit.meta.mtimeMs === stats.mtimeMs && hit.meta.size === stats.size) {
        notes.set(file, { meta: { ...hit.meta, ctimeMs: stats.ctimeMs }, rel: this._rel(file), contexts: hit.contexts })
        return
      }
      const record = await this._readNote(file, stats)
      if (record) notes.set(file, record)
    })
    this._notes = notes
    this._assets = assets
    this._resolveAll()
  }

  /**
   * Applies folder watcher events and save/rename notifications. Each event
   * only says "this path may have changed": the disk decides, so duplicated
   * or reordered events (one watcher per window) are harmless. Existing files
   * are re-read when mtime or size changed and folders are scanned; missing
   * paths (and, for `unlinkDir`, everything below them) are dropped. Returns
   * the notes whose metadata changed, including notes whose link resolution
   * changed because files appeared or disappeared.
   */
  async applyChanges(changes: VaultFsChange[]): Promise<VaultChangeEvent> {
    const changed = new Set<string>()
    const removed = new Set<string>()
    let fileSetChanged = false

    const upsertFile = async(file: string, known?: VaultFileStats): Promise<void> => {
      if (this.isIgnored(file)) return
      const stats = known ?? (await this._fs.stat(file))
      if (!stats) {
        if (this._remove(file, removed)) fileSetChanged = true
        return
      }
      if (!stats.isFile) return
      if (!hasMarkdownExtension(file)) {
        if (!this._assets.has(file)) fileSetChanged = true
        this._assets.set(file, this._assetRecord(file, stats))
        return
      }
      const existing = this._notes.get(file)
      if (existing && existing.meta.mtimeMs === stats.mtimeMs && existing.meta.size === stats.size) return
      const record = await this._readNote(file, stats)
      if (!record) return
      if (!existing) fileSetChanged = true
      this._notes.set(file, record)
      changed.add(file)
      removed.delete(file)
    }
    // Only the changed path itself may be a folder; files found below it are
    // never descended into, so symlinked folders cannot cause cycles.
    const upsert = async(file: string): Promise<void> => {
      if (this.isIgnored(file)) return
      const stats = await this._fs.stat(file)
      if (stats?.isDirectory) {
        for (const child of await this._fs.walk(file, (p) => this.isIgnored(p))) await upsertFile(child)
      } else {
        await upsertFile(file, stats ?? undefined)
      }
    }

    // Folders already holding indexed files are not re-walked on `addDir`: the
    // watcher's initial scan reports every folder, and files inside a folder
    // get their own events. Only genuinely new folders are walked, which also
    // picks up the files the watcher does not report (images and the like).
    const knownFolders = new Set<string>()
    for (const key of [...this._notes.keys(), ...this._assets.keys()]) {
      for (let dir = path.dirname(key); dir.length > this.rootPath.length && !knownFolders.has(dir); dir = path.dirname(dir)) {
        knownFolders.add(dir)
      }
    }

    for (const change of changes) {
      const file = path.resolve(change.path)
      if (change.type === 'addDir' && knownFolders.has(file)) continue
      if (change.type === 'unlinkDir') {
        const prefix = file + path.sep
        for (const key of [...this._notes.keys(), ...this._assets.keys()]) {
          if (key.startsWith(prefix) && this._remove(key, removed)) fileSetChanged = true
        }
      }
      await upsert(file)
    }

    for (const file of removed) changed.delete(file)
    if (fileSetChanged) {
      for (const file of this._resolveAll()) changed.add(file)
    } else {
      for (const file of changed) {
        const record = this._notes.get(file)
        if (record) this._resolveNote(record)
      }
    }
    if (changed.size || removed.size) {
      this._backlinks = null
      this._tags = null
    }
    return { changed: [...changed].sort(), removed: [...removed].sort() }
  }

  getFile(absPath: string): FileMetadata | null {
    return this._notes.get(path.resolve(absPath))?.meta ?? null
  }

  listFiles(): FileMetadata[] {
    return [...this._notes.values()].map((record) => record.meta).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  listAssets(): VaultFileEntry[] {
    return [...this._assets.values()].map((record) => record.entry).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  resolveLink(target: string, sourcePath: string): string | null {
    const rel = this._resolverFor().resolve(target, this._relOrEmpty(sourcePath))
    return rel === null ? null : path.join(this.rootPath, ...rel.split('/'))
  }

  /** Links pointing at `absPath` from other notes, ordered by source path and position. */
  getBacklinks(absPath: string): BacklinkEntry[] {
    if (!this._backlinks) {
      const map = new Map<string, BacklinkEntry[]>()
      for (const record of this._sortedNotes()) {
        record.meta.links.forEach((link, i) => {
          if (!link.resolved || link.resolved === record.meta.path) return
          const entry: BacklinkEntry = { sourcePath: record.meta.path, link, context: record.contexts[i] ?? '' }
          const list = map.get(link.resolved)
          if (list) list.push(entry)
          else map.set(link.resolved, [entry])
        })
      }
      this._backlinks = map
    }
    return this._backlinks.get(path.resolve(absPath)) ?? []
  }

  /**
   * Number of notes carrying each tag, aggregated case-insensitively (the
   * spelling of the first note in path order wins). A nested tag also counts
   * for each parent: a note tagged `#a/b` counts once for `a` and once for
   * `a/b`. Sorted by count (descending), then tag.
   */
  getTags(): TagCount[] {
    if (!this._tags) {
      const counts = new Map<string, TagCount>()
      for (const record of this._sortedNotes()) {
        const seen = new Set<string>()
        for (const tag of record.meta.tags) {
          const parts = tag.split('/')
          for (let depth = 1; depth <= parts.length; depth++) {
            const name = parts.slice(0, depth).join('/')
            const key = name.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            const entry = counts.get(key)
            if (entry) entry.count++
            else counts.set(key, { tag: name, count: 1 })
          }
        }
      }
      this._tags = [...counts.values()].sort(
        (a, b) => b.count - a.count || a.tag.toLowerCase().localeCompare(b.tag.toLowerCase())
      )
    }
    return this._tags.map((entry) => ({ ...entry }))
  }

  /** Notes carrying `tag` (leading `#` optional, case-insensitive); `includeNested` also matches `tag/…`. Sorted paths. */
  getFilesWithTag(tag: string, options: { includeNested?: boolean } = {}): string[] {
    const wanted = tag.replace(/^#/, '').toLowerCase()
    if (!wanted) return []
    const prefix = `${wanted}/`
    const result: string[] = []
    for (const record of this._sortedNotes()) {
      const hit = record.meta.tags.some((t) => {
        const lower = t.toLowerCase()
        return lower === wanted || (options.includeNested === true && lower.startsWith(prefix))
      })
      if (hit) result.push(record.meta.path)
    }
    return result
  }

  /** Serializable snapshot for the persisted cache. */
  toCache(): VaultIndexCache {
    return {
      version: VAULT_INDEX_CACHE_VERSION,
      rootPath: this.rootPath,
      notes: this._sortedNotes().map((record) => ({ meta: record.meta, contexts: record.contexts }))
    }
  }

  // --- internals -----------------------------------------------------------

  private _rel(absPath: string): string {
    return toPosix(path.relative(this.rootPath, absPath))
  }

  private _relOrEmpty(absPath: string): string {
    const rel = path.relative(this.rootPath, path.resolve(absPath))
    return rel.startsWith('..') || path.isAbsolute(rel) ? '' : toPosix(rel)
  }

  private _sortedNotes(): NoteRecord[] {
    return [...this._notes.values()].sort((a, b) => (a.meta.path < b.meta.path ? -1 : a.meta.path > b.meta.path ? 1 : 0))
  }

  private _resolverFor(): LinkResolver {
    if (!this._resolver) {
      const rels: string[] = []
      for (const record of this._notes.values()) rels.push(record.rel)
      for (const record of this._assets.values()) rels.push(record.rel)
      this._resolver = createLinkResolver(rels)
    }
    return this._resolver
  }

  /** Re-resolves one note's links in place; true when any resolution changed. */
  private _resolveNote(record: NoteRecord): boolean {
    const resolver = this._resolverFor()
    const links = record.meta.links.map((link) => {
      const rel = resolver.resolve(link.target, record.rel, { preferRelative: link.kind === 'markdown' })
      return { ...link, resolved: rel === null ? null : path.join(this.rootPath, ...rel.split('/')) }
    })
    if (sameLinks(links, record.meta.links)) return false
    record.meta = { ...record.meta, links }
    return true
  }

  /** Rebuilds the resolver and re-resolves every note; returns notes whose resolution changed. */
  private _resolveAll(): string[] {
    this._resolver = null
    this._backlinks = null
    this._tags = null
    const changed: string[] = []
    for (const record of this._notes.values()) {
      if (this._resolveNote(record)) changed.push(record.meta.path)
    }
    return changed
  }

  private _remove(file: string, removed: Set<string>): boolean {
    if (this._notes.delete(file)) {
      removed.add(file)
      return true
    }
    return this._assets.delete(file)
  }

  private _assetRecord(file: string, stats: VaultFileStats): AssetRecord {
    return {
      rel: this._rel(file),
      entry: {
        path: file,
        name: path.basename(file),
        extension: path.extname(file).slice(1).toLowerCase(),
        size: stats.size,
        mtimeMs: stats.mtimeMs
      }
    }
  }

  private async _readNote(file: string, stats: VaultFileStats): Promise<NoteRecord | null> {
    let markdown = ''
    if (stats.size <= this._maxParseBytes) {
      try {
        markdown = await this._fs.readText(file)
      } catch {
        return null
      }
      if (markdown.charCodeAt(0) === 0xfeff) markdown = markdown.slice(1)
    }
    const parsed = parseNote(markdown)
    const name = path.basename(file)
    const basename = name.slice(0, name.length - path.extname(name).length)
    const lines = markdown.split(/\r\n?|\n/)
    const meta: FileMetadata = {
      path: file,
      name,
      basename,
      folder: path.dirname(file),
      size: stats.size,
      ctimeMs: stats.ctimeMs,
      mtimeMs: stats.mtimeMs,
      frontmatter: parsed.frontmatter,
      aliases: parsed.aliases,
      tags: parsed.tags,
      headings: parsed.headings,
      links: parsed.links.map((link) => ({ ...link, resolved: null })),
      tasks: parsed.tasks,
      fields: parsed.fields,
      day: getDailyNoteDate(basename),
      wordCount: parsed.wordCount
    }
    return { meta, rel: this._rel(file), contexts: parsed.links.map((link) => (lines[link.line] ?? '').trim()) }
  }

  private async _forEachConcurrent(items: string[], fn: (item: string) => Promise<void>): Promise<void> {
    let next = 0
    const workers = Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, async() => {
      while (next < items.length) await fn(items[next++])
    })
    await Promise.all(workers)
  }
}
