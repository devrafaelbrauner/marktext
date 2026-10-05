// In-memory FileBackend for unit tests and the browser dev build (no native
// side). Pickers resolve to whatever the test queued, else cancel.

import { posix } from 'pathe'
import { MobileFsError, type DirEntry, type FileBackend, type FileStat, type PickedEntry } from './backend'

interface Node {
  kind: 'file' | 'dir'
  data: Uint8Array
  mtimeMs: number
  birthtimeMs: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class MemoryFileBackend implements FileBackend {
  private readonly nodes = new Map<string, Node>()
  private clock = 1_700_000_000_000
  readonly pickQueue: Array<PickedEntry | null> = []

  constructor(files: Record<string, string> = {}) {
    this.nodes.set('/', this.node('dir'))
    for (const [path, content] of Object.entries(files)) this.put(path, content)
  }

  /** Synchronous seeding for tests. */
  put(path: string, content: string | Uint8Array): void {
    this.ensureParents(path)
    const existing = this.nodes.get(path)
    const node = this.node('file', typeof content === 'string' ? encoder.encode(content) : content)
    if (existing) node.birthtimeMs = existing.birthtimeMs
    this.nodes.set(path, node)
  }

  async stat(path: string): Promise<FileStat | null> {
    const node = this.nodes.get(normalize(path))
    if (!node) return null
    return {
      isFile: node.kind === 'file',
      isDirectory: node.kind === 'dir',
      size: node.data.byteLength,
      mtimeMs: node.mtimeMs,
      birthtimeMs: node.birthtimeMs
    }
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const dir = normalize(path)
    this.expect(dir, 'dir')
    const prefix = dir === '/' ? '/' : `${dir}/`
    const out: DirEntry[] = []
    for (const [key, node] of this.nodes) {
      if (key === dir || !key.startsWith(prefix) || key.slice(prefix.length).includes('/')) continue
      out.push({ name: key.slice(prefix.length), isFile: node.kind === 'file', isDirectory: node.kind === 'dir' })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.expect(normalize(path), 'file').data.slice()
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readFile(path))
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const target = normalize(path)
    if (this.nodes.get(target)?.kind === 'dir') throw new MobileFsError('EISDIR', target)
    this.put(target, typeof data === 'string' ? data : data.slice())
  }

  async mkdirp(path: string): Promise<void> {
    const target = normalize(path)
    if (this.nodes.get(target)?.kind === 'file') throw new MobileFsError('ENOTDIR', target)
    this.ensureParents(`${target}/x`)
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalize(from)
    const dest = normalize(to)
    if (!this.nodes.has(src)) throw new MobileFsError('ENOENT', src)
    if (this.nodes.has(dest)) throw new MobileFsError('EEXIST', dest)
    this.ensureParents(dest)
    for (const [key, node] of [...this.nodes]) {
      if (key === src || key.startsWith(`${src}/`)) {
        this.nodes.delete(key)
        this.nodes.set(dest + key.slice(src.length), node)
      }
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const src = this.expect(normalize(from), 'file')
    this.put(normalize(to), src.data.slice())
  }

  async remove(path: string): Promise<void> {
    const target = normalize(path)
    if (!this.nodes.has(target)) throw new MobileFsError('ENOENT', target)
    for (const key of [...this.nodes.keys()]) {
      if (key === target || key.startsWith(`${target}/`)) this.nodes.delete(key)
    }
  }

  async pickDirectory(): Promise<PickedEntry | null> {
    return this.pickQueue.shift() ?? null
  }

  async pickOpenFile(): Promise<PickedEntry | null> {
    return this.pickQueue.shift() ?? null
  }

  async pickSaveFile(): Promise<PickedEntry | null> {
    return this.pickQueue.shift() ?? null
  }

  private node(kind: Node['kind'], data: Uint8Array = new Uint8Array()): Node {
    const now = (this.clock += 1000)
    return { kind, data, mtimeMs: now, birthtimeMs: now }
  }

  private ensureParents(path: string): void {
    let dir = posix.dirname(normalize(path))
    const missing: string[] = []
    while (!this.nodes.has(dir)) {
      missing.push(dir)
      dir = posix.dirname(dir)
    }
    if (this.nodes.get(dir)?.kind === 'file') throw new MobileFsError('ENOTDIR', dir)
    for (const each of missing.reverse()) this.nodes.set(each, this.node('dir'))
  }

  private expect(path: string, kind: Node['kind']): Node {
    const node = this.nodes.get(path)
    if (!node) throw new MobileFsError('ENOENT', path)
    if (node.kind !== kind) throw new MobileFsError(kind === 'dir' ? 'ENOTDIR' : 'EISDIR', path)
    return node
  }
}

const normalize = (path: string): string => {
  const out = posix.normalize(path)
  return out.length > 1 && out.endsWith('/') ? out.slice(0, -1) : out
}
