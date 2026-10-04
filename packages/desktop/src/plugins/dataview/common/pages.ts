import type { BacklinkEntry, FileMetadata, TaskEntry } from '@shared/plugins/types'
import { findTags, parseWikilink } from 'common/markdownExt'
import {
  makeDate,
  makeObject,
  parseDateText,
  parseDurationText,
  setEntry,
  type LinkValue,
  type ObjectValue,
  type Value
} from './values'

/**
 * The part of the vault index a query reads (structurally the worker's
 * `VaultIndexReader`). Paths are absolute.
 */
export interface QueryIndex {
  readonly rootPath: string
  getFile(path: string): FileMetadata | null
  /** Every indexed note, sorted by path. */
  listFiles(): FileMetadata[]
  resolveLink(target: string, sourcePath: string): string | null
  getBacklinks(path: string): BacklinkEntry[]
}

/** Nesting limit when converting front matter, which YAML anchors can make cyclic. */
const MAX_DEPTH = 16

const toSlashes = (path: string): string => path.replace(/\\/g, '/')

/** Tag with its parents, Dataview style: `a/b/c` → `#a`, `#a/b`, `#a/b/c`. */
const expandTag = (tag: string): string[] => {
  const parts = tag.split('/')
  return parts.map((_, i) => `#${parts.slice(0, i + 1).join('/')}`)
}

const uniqueStrings = (values: string[]): string[] => [...new Set(values)]

export interface TaskRecord {
  /** Absolute path of the note. */
  path: string
  entry: TaskEntry
  /** Task object as listed in `file.tasks` (no `file` key, which would make the page cyclic). */
  task: ObjectValue
}

/**
 * Builds Dataview page objects from index metadata, once per file and run:
 * front matter keys (original case; strings that look like dates,
 * durations or a single `[[link]]` become typed values), inline fields
 * (lower-case keys) and the implicit `file` object.
 */
export class PageStore {
  private readonly root: string
  private readonly pages = new Map<string, ObjectValue | null>()
  private readonly tasks = new Map<string, TaskRecord[]>()

  constructor(readonly index: QueryIndex) {
    this.root = toSlashes(index.rootPath).replace(/\/+$/, '')
  }

  /** Vault-relative path with `/` separators. */
  relativePath(path: string): string {
    const normalized = toSlashes(path)
    return normalized.startsWith(`${this.root}/`) ? normalized.slice(this.root.length + 1) : normalized
  }

  fileLink(path: string): LinkValue {
    return { type: 'link', path, display: null, subpath: null, embed: false, resolved: true }
  }

  /**
   * Resolves `target` like a link written in `sourcePath` (null: the vault
   * root); unresolved links keep the target as their path. An empty target
   * points at the source note itself.
   */
  link(target: string, sourcePath: string | null, display: string | null, subpath: string | null = null, embed = false): LinkValue {
    const resolved = target ? this.index.resolveLink(target, sourcePath ?? this.index.rootPath) : sourcePath
    return { type: 'link', path: resolved ?? target, display, subpath, embed, resolved: resolved !== null }
  }

  page(path: string): ObjectValue | null {
    if (this.pages.has(path)) return this.pages.get(path) ?? null
    const meta = this.index.getFile(path)
    const page = meta ? this.buildPage(meta) : null
    this.pages.set(path, page)
    return page
  }

  /** Tasks of a note with their task objects. */
  tasksOf(path: string): TaskRecord[] {
    const cached = this.tasks.get(path)
    if (cached) return cached
    const meta = this.index.getFile(path)
    const records = meta ? meta.tasks.map((entry) => ({ path, entry, task: this.buildTask(meta, entry) })) : []
    this.tasks.set(path, records)
    return records
  }

  /** Converts a front matter or inline field value; `parseStrings` types date/duration/link-shaped strings. */
  convert(raw: unknown, sourcePath: string, parseStrings: boolean, depth = 0): Value {
    if (raw === null || raw === undefined || depth > MAX_DEPTH) return null
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    if (typeof raw === 'bigint') return Number(raw)
    if (typeof raw === 'string') return parseStrings ? this.parseString(raw, sourcePath) : raw
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : makeDate(raw.getTime(), false)
    if (Array.isArray(raw)) return raw.map((item) => this.convert(item, sourcePath, parseStrings, depth + 1))
    if (typeof raw === 'object') {
      return makeObject(
        Object.entries(raw).map(([key, value]): [string, Value] => [
          key,
          this.convert(value, sourcePath, parseStrings, depth + 1)
        ])
      )
    }
    return null
  }

  private parseString(raw: string, sourcePath: string): Value {
    const text = raw.trim()
    if (text.startsWith('[[') || text.startsWith('![[')) {
      const wikilink = parseWikilink(text)
      if (wikilink) {
        const subpath = wikilink.blockId ? `^${wikilink.blockId}` : (wikilink.heading ?? wikilink.subpath ?? null)
        return this.link(wikilink.target, sourcePath, wikilink.alias ?? null, subpath, wikilink.embed)
      }
    }
    if (/^\d{4}-\d{2}/.test(text)) {
      const date = parseDateText(text)
      if (date) return date
    }
    if (/^\d/.test(text)) {
      const duration = parseDurationText(text)
      if (duration) return duration
    }
    return raw
  }

  private buildFile(meta: FileMetadata): ObjectValue {
    const relative = this.relativePath(meta.path)
    const slash = relative.lastIndexOf('/')
    const dot = meta.name.lastIndexOf('.')
    const startOfDay = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0)
    const day = meta.day ? parseDateText(meta.day) : null

    const outlinks: LinkValue[] = []
    const seenOutlinks = new Set<string>()
    for (const reference of meta.links) {
      const subpath = reference.blockId ? `^${reference.blockId}` : (reference.heading ?? reference.subpath ?? null)
      const path = reference.resolved ?? reference.target
      const key = `${path}#${subpath ?? ''}#${reference.embed}`
      if (seenOutlinks.has(key)) continue
      seenOutlinks.add(key)
      outlinks.push({ type: 'link', path, display: null, subpath, embed: reference.embed, resolved: reference.resolved !== null })
    }
    const inlinks = uniqueStrings(this.index.getBacklinks(meta.path).map((entry) => entry.sourcePath))
      .sort()
      .map((source) => this.fileLink(source))

    return makeObject([
      ['name', meta.basename],
      ['path', relative],
      ['folder', slash === -1 ? '' : relative.slice(0, slash)],
      ['ext', dot === -1 ? '' : meta.name.slice(dot + 1)],
      ['link', this.fileLink(meta.path)],
      ['size', meta.size],
      ['ctime', makeDate(meta.ctimeMs, false)],
      ['mtime', makeDate(meta.mtimeMs, false)],
      ['cday', makeDate(startOfDay(meta.ctimeMs), true)],
      ['mday', makeDate(startOfDay(meta.mtimeMs), true)],
      ['tags', uniqueStrings(meta.tags.flatMap(expandTag))],
      ['etags', uniqueStrings(meta.tags.map((tag) => `#${tag}`))],
      ['inlinks', inlinks],
      ['outlinks', outlinks],
      ['aliases', [...meta.aliases]],
      ['tasks', this.tasksOf(meta.path).map((record) => record.task)],
      ['day', day],
      ['frontmatter', this.convert(meta.frontmatter ?? {}, meta.path, false)]
    ])
  }

  private buildPage(meta: FileMetadata): ObjectValue {
    const page = makeObject([])
    for (const [key, value] of Object.entries(meta.frontmatter ?? {})) {
      setEntry(page.entries, key, this.convert(value, meta.path, true))
    }
    // An inline field repeating a front matter key joins it into one list, as in Dataview.
    for (const [key, value] of Object.entries(meta.fields)) {
      const converted = this.convert(value, meta.path, true)
      if (!Object.hasOwn(page.entries, key)) {
        setEntry(page.entries, key, converted)
        continue
      }
      const existing = page.entries[key]
      setEntry(page.entries, key, [existing, converted].flat())
    }
    setEntry(page.entries, 'file', this.buildFile(meta))
    return page
  }

  private buildTask(meta: FileMetadata, entry: TaskEntry): ObjectValue {
    const task = makeObject([])
    for (const [key, value] of Object.entries(entry.fields)) setEntry(task.entries, key, this.convert(value, meta.path, true))
    // Built-in properties win over inline fields of the same name (`[completed:: 2026-09-02]`).
    const completed = entry.status === 'x' || entry.status === 'X'
    const builtins: Array<[string, Value]> = [
      ['text', entry.text],
      ['status', entry.status],
      ['checked', entry.checked],
      ['completed', completed],
      ['fullyCompleted', completed],
      ['task', true],
      ['line', entry.line],
      ['path', this.relativePath(meta.path)],
      ['link', this.fileLink(meta.path)],
      ['tags', uniqueStrings(findTags(entry.text).map(({ tag }) => `#${tag}`))]
    ]
    for (const [key, value] of builtins) setEntry(task.entries, key, value)
    return task
  }
}
