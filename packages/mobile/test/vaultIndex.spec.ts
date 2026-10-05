import { createHash } from 'crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { BacklinkEntry, FileMetadata, TagCount, VaultChangeEvent } from '@shared/plugins/types'
import type { VaultIndexReadyState } from '@shared/types/ipc'
import { MARKDOWN_INCLUSIONS } from 'common/filesystem/extensions'
// Registers `links.unlinkedMentions`, as the worker entry's plugin glob does.
import '../../desktop/src/plugins/links/worker/index'
import type { FileStat } from '../src/main/fs/backend'
import { MemoryFileBackend } from '../src/main/fs/memoryBackend'
import { EDITOR_WINDOW_ID, connectWindow } from '../src/main/ipc'
import { fsChanged, setBackend, setRootPath } from '../src/main/state'
import { VAULT_INDEX_CACHE_DIR, registerVaultIndex, type SpawnIndexWorker } from '../src/main/vaultIndex'
import type { TextMatch, WorkerToHostMessage } from '../src/main/vaultIndex/protocol'
import { parseMaxFileSize } from '../src/main/vaultIndex/search'
import { createIndexWorker } from '../src/main/vaultIndex/worker'

// The worker logic runs in-process behind a structured-clone, next-task
// boundary, like the Web Worker it runs in on Android.
const spawnInProcess: SpawnIndexWorker = () => {
  const listeners: Array<(message: WorkerToHostMessage) => void> = []
  let alive = true
  const worker = createIndexWorker((message) => {
    const copy = structuredClone(message)
    setTimeout(() => {
      if (alive) for (const listener of listeners) listener(copy)
    }, 0)
  })
  return {
    postMessage: (message) => {
      const copy = structuredClone(message)
      setTimeout(() => alive && worker.handle(copy), 0)
    },
    onMessage: (listener) => listeners.push(listener),
    onError: () => {},
    terminate: () => {
      alive = false
    }
  }
}

const renderer = connectWindow(EDITOR_WINDOW_ID)
const readyStates: VaultIndexReadyState[] = []
const changes: VaultChangeEvent[] = []

const VAULT = {
  'Home.md': '# Home\nSee [[Ideas]] and [[Missing]]. #project/alpha\n',
  'Ideas.md': '# Ideas\n#idea\nBack to [[Home]].\nfoo Foo food\n',
  'sub/Tasks.md': '- [ ] call about the Ideas #project\nfoo bar\n',
  '.hidden/Secret.md': 'foo\n',
  'image.png': 'png'
}

let backend: MemoryFileBackend
let vaultCount = 0

/** Opens a fresh copy of `files` as a new folder and waits for its index. */
async function openVault(files: Record<string, string> = VAULT): Promise<(rel: string) => string> {
  const root = `/vault/k${++vaultCount}/Notes`
  backend = new MemoryFileBackend(Object.fromEntries(Object.entries(files).map(([rel, text]) => [`${root}/${rel}`, text])))
  setBackend(backend)
  setRootPath(root)
  await vi.waitFor(() => expect(readyStates.at(-1)).toEqual({ rootPath: root, ready: true }))
  return (rel) => (rel ? `${root}/${rel}` : root)
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => renderer.invoke(channel, ...args) as Promise<T>

async function statOf(file: string): Promise<FileStat> {
  const stats = await backend.stat(file)
  if (!stats) throw new Error(`missing ${file}`)
  return stats
}

interface SearchRun {
  results: unknown[]
  progress: number[]
  end: Promise<{ channel: 'done' | 'cancelled' | 'error'; error?: string }>
}

let searchCount = 0
function startSearch(mode: 'text' | 'files', pattern: string, options: Record<string, unknown>, directory: string): SearchRun & { searchId: string } {
  const searchId = `spec-${++searchCount}`
  const run: SearchRun = { results: [], progress: [], end: Promise.resolve({ channel: 'done' }) }
  const own = (payload: unknown): payload is { searchId: string; payload?: unknown; num?: number; error?: string } =>
    typeof payload === 'object' && payload !== null && 'searchId' in payload && payload.searchId === searchId
  renderer.on('mt::rg::match', (_e, payload) => {
    if (own(payload)) run.results.push(payload.payload)
  })
  renderer.on('mt::rg::progress', (_e, payload) => {
    if (own(payload)) run.progress.push(payload.num ?? -1)
  })
  run.end = new Promise((resolve) => {
    for (const channel of ['done', 'cancelled', 'error'] as const) {
      renderer.on(`mt::rg::${channel}`, (_e, payload) => {
        if (own(payload)) resolve({ channel, error: payload.error })
      })
    }
  })
  invoke('mt::rg::start', { searchId, mode, directories: [directory], pattern, options })
  return { ...run, searchId }
}

async function search(pattern: string, options: Record<string, unknown>, directory: string): Promise<Array<{ filePath: string; matches: TextMatch[] }>> {
  const run = startSearch('text', pattern, { inclusions: [...MARKDOWN_INCLUSIONS], ...options }, directory)
  expect(await run.end).toEqual({ channel: 'done', error: undefined })
  return run.results as Array<{ filePath: string; matches: TextMatch[] }>
}

beforeAll(() => {
  registerVaultIndex(spawnInProcess)
  renderer.on('mt::index::ready', (_e, state) => readyStates.push(state as VaultIndexReadyState))
  renderer.on('mt::index::changed', (_e, event) => changes.push(event as VaultChangeEvent))
})

describe('vault index', () => {
  it('is ready once a folder is open and persists its cache under the app data folder', async() => {
    expect(await invoke('mt::index::is-ready')).toBe(false)
    const abs = await openVault()
    expect(await invoke('mt::index::is-ready')).toBe(true)
    const files = await invoke<FileMetadata[]>('mt::index::list-files')
    expect(files.map((file) => file.path)).toEqual([abs('Home.md'), abs('Ideas.md'), abs('sub/Tasks.md')])

    const sha1 = createHash('sha1').update(abs('')).digest('hex')
    const cacheFile = `${VAULT_INDEX_CACHE_DIR}/${sha1}.json`
    await vi.waitFor(async() => expect(await backend.stat(cacheFile)).not.toBeNull(), { timeout: 5000 })
    const cache = JSON.parse(await backend.readText(cacheFile)) as { rootPath: string; notes: unknown[] }
    expect(cache.rootPath).toBe(abs(''))
    expect(cache.notes).toHaveLength(3)
  })

  it('answers backlinks, tags, link resolution and tag queries with the desktop shapes', async() => {
    const abs = await openVault()
    const backlinks = await invoke<BacklinkEntry[]>('mt::index::backlinks', abs('Home.md'))
    expect(backlinks).toHaveLength(1)
    expect(backlinks[0]).toMatchObject({ sourcePath: abs('Ideas.md'), context: 'Back to [[Home]].' })
    expect(backlinks[0].link).toMatchObject({ target: 'Home', resolved: abs('Home.md') })

    expect(await invoke<TagCount[]>('mt::index::tags')).toEqual([
      { tag: 'project', count: 2 },
      { tag: 'idea', count: 1 },
      { tag: 'project/alpha', count: 1 }
    ])
    expect(await invoke('mt::index::resolve-link', 'Ideas', abs('Home.md'))).toBe(abs('Ideas.md'))
    expect(await invoke('mt::index::resolve-link', 'Missing', abs('Home.md'))).toBeNull()
    expect(await invoke('mt::index::resolve-link', 'image.png', abs('sub/Tasks.md'))).toBe(abs('image.png'))
    expect(await invoke('mt::index::files-with-tag', 'project')).toEqual([abs('sub/Tasks.md')])
    expect(await invoke('mt::index::files-with-tag', '#project', { includeNested: true })).toEqual([
      abs('Home.md'),
      abs('sub/Tasks.md')
    ])
    expect((await invoke<FileMetadata>('mt::index::get-file', abs('Ideas.md'))).headings[0]).toMatchObject({ text: 'Ideas' })
    expect(await invoke('mt::index::get-file', abs('.hidden/Secret.md'))).toBeNull()
    await expect(invoke('mt::index::get-file', 42)).rejects.toThrow('path must be a string')
  })

  it('runs plugin worker handlers that read notes through the file bridge', async() => {
    const abs = await openVault()
    const result = await invoke<{ files: Array<{ sourcePath: string }> }>('mt::index::request', 'links.unlinkedMentions', {
      path: abs('Ideas.md')
    })
    expect(result.files.map((file) => file.sourcePath)).toEqual([abs('sub/Tasks.md')])
  })

  it('applies app-made writes reported through fsChanged', async() => {
    const abs = await openVault()
    changes.length = 0
    await backend.writeFile(abs('Home.md'), '# Home\n#fresh\n')
    const { mtimeMs } = await statOf(abs('Home.md'))
    fsChanged.emit({ type: 'change', pathname: abs('Home.md'), mtimeMs })
    await backend.remove(abs('sub/Tasks.md'))
    fsChanged.emit({ type: 'unlink', pathname: abs('sub/Tasks.md') })

    await vi.waitFor(() => expect(changes).toContainEqual({ changed: [abs('Home.md')], removed: [abs('sub/Tasks.md')] }))
    expect(await invoke('mt::index::files-with-tag', 'fresh')).toEqual([abs('Home.md')])
    expect(await invoke('mt::index::tags')).toEqual([
      { tag: 'fresh', count: 1 },
      { tag: 'idea', count: 1 }
    ])
    // The unchanged note's link to Home stays resolved, its backlink updated.
    expect((await invoke<BacklinkEntry[]>('mt::index::backlinks', abs('Home.md')))[0].sourcePath).toBe(abs('Ideas.md'))
  })

  it('picks up changes made by other apps when the app returns to the foreground', async() => {
    const abs = await openVault()
    changes.length = 0
    backend.put(abs('External.md'), 'Written elsewhere #ext\n')
    backend.put(abs('Ideas.md'), '# Ideas\n#idea/edited\n')
    await backend.remove(abs('sub/Tasks.md'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(changes).toEqual([])

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() =>
      expect(changes).toContainEqual({ changed: [abs('External.md'), abs('Ideas.md')], removed: [abs('sub/Tasks.md')] })
    )
    expect(await invoke('mt::index::files-with-tag', 'ext')).toEqual([abs('External.md')])
    expect(await invoke('mt::index::files-with-tag', 'idea', { includeNested: true })).toEqual([abs('Ideas.md')])
  })

  it('reports no folder after the folder is closed', async() => {
    await openVault()
    setRootPath(null)
    await vi.waitFor(() => expect(readyStates.at(-1)).toEqual({ rootPath: null, ready: false }))
    expect(await invoke('mt::index::is-ready')).toBe(false)
    expect(await invoke('mt::index::tags')).toEqual([])
  })
})

describe('full-text search (mt::rg::*)', () => {
  it('matches case-insensitively by default and skips hidden folders', async() => {
    const abs = await openVault()
    const results = await search('foo', {}, abs(''))
    expect(results.map((result) => result.filePath)).toEqual([abs('Ideas.md'), abs('sub/Tasks.md')])
    expect(results[0].matches.map((match) => [match.matchText, match.range])).toEqual([
      ['foo', [[3, 0], [3, 3]]],
      ['Foo', [[3, 4], [3, 7]]],
      ['foo', [[3, 8], [3, 11]]]
    ])
    expect(results[0].matches[0]).toEqual({
      matchText: 'foo',
      lineText: 'foo Foo food',
      range: [[3, 0], [3, 3]],
      leadingContextLines: [],
      trailingContextLines: []
    })
  })

  it('honours case-sensitive, whole-word and regular-expression flags', async() => {
    const abs = await openVault()
    const caseSensitive = await search('Foo', { isCaseSensitive: true }, abs(''))
    expect(caseSensitive.map((result) => [result.filePath, result.matches.length])).toEqual([[abs('Ideas.md'), 1]])

    const wholeWord = await search('foo', { isWholeWord: true }, abs(''))
    expect(wholeWord.map((result) => [result.filePath, result.matches.map((match) => match.matchText)])).toEqual([
      [abs('Ideas.md'), ['foo', 'Foo']],
      [abs('sub/Tasks.md'), ['foo']]
    ])

    const regexp = await search('fo+d', { isRegexp: true }, abs(''))
    expect(regexp.map((result) => [result.filePath, result.matches[0].range])).toEqual([[abs('Ideas.md'), [[3, 8], [3, 12]]]])

    const multiline = await search('Ideas\\n#idea', { isRegexp: true }, abs(''))
    expect(multiline[0].matches[0]).toMatchObject({ lineText: '# Ideas\n#idea', range: [[0, 2], [1, 5]] })

    // A literal search treats regexp syntax as text.
    expect(await search('fo+d', {}, abs(''))).toEqual([])
  })

  it('applies inclusion, exclusion and file size limits', async() => {
    const abs = await openVault()
    const excluded = await search('foo', { exclusions: ['sub'] }, abs(''))
    expect(excluded.map((result) => result.filePath)).toEqual([abs('Ideas.md')])
    const tasksSize = (await statOf(abs('sub/Tasks.md'))).size
    expect((await statOf(abs('Ideas.md'))).size).toBeGreaterThan(tasksSize)
    const limited = await search('foo', { maxFileSize: String(tasksSize) }, abs(''))
    expect(limited.map((result) => result.filePath)).toEqual([abs('sub/Tasks.md')])
    expect(parseMaxFileSize('2K')).toBe(2048)
    expect(parseMaxFileSize('')).toBeNull()
  })

  it('lists matching file names in files mode (quick open)', async() => {
    const abs = await openVault()
    const run = startSearch('files', '', { inclusions: MARKDOWN_INCLUSIONS.map((ext) => `*idea${ext}`) }, abs(''))
    expect(await run.end).toEqual({ channel: 'done', error: undefined })
    expect(run.results).toEqual([abs('Ideas.md')])
    expect(run.progress).toEqual([1])
  })

  it('stops at maxResults and streams progress per file', async() => {
    const abs = await openVault()
    const run = startSearch('text', 'foo', { maxResults: 1 }, abs(''))
    expect((await run.end).channel).toBe('done')
    expect(run.results).toHaveLength(1)
    expect(run.progress).toEqual([1])
  })

  it('cancels a running search', async() => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 300; i++) files[`n${String(i).padStart(3, '0')}.md`] = `needle ${i}\n`
    const abs = await openVault(files)
    const run = startSearch('text', 'needle', {}, abs(''))
    // The worker yields between batches of files, so the cancel lands mid-run.
    renderer.send('mt::rg::cancel', run.searchId)
    expect((await run.end).channel).toBe('cancelled')
    const seen = run.results.length
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(run.results.length).toBe(seen)
    expect(seen).toBeLessThan(300)
  })

  it('reports an error without an open folder or outside it', async() => {
    const abs = await openVault()
    const outside = startSearch('text', 'foo', {}, '/vault/elsewhere')
    expect(await outside.end).toEqual({ channel: 'error', error: '"/vault/elsewhere" is outside the open folder' })
    setRootPath(null)
    const none = startSearch('text', 'foo', {}, abs(''))
    expect(await none.end).toEqual({ channel: 'error', error: 'No folder is open' })
  })
})
