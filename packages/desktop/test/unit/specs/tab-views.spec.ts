import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'

vi.hoisted(() => {
  const w = globalThis as unknown as { window?: Record<string, unknown> }
  w.window ??= {}
  const win = w.window as Record<string, unknown>
  win.path = {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/')) || '/',
    basename: (p: string) => p.slice(p.lastIndexOf('/') + 1),
    join: (...parts: string[]) => parts.join('/')
  }
  win.fileUtils = { isSamePathSync: (a: string, b: string) => !!a && a === b }
  win.electron = {
    clipboard: { writeText: () => {} },
    ipcRenderer: {
      send: () => {},
      on: () => {},
      invoke: () => Promise.resolve(true)
    },
    shell: { openPath: () => Promise.resolve('') }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(() => Promise.resolve()), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import { createDocumentState } from '@/store/help'
import bus from '@/bus'
import {
  findMatchingMarkdownView,
  getAssetViewForPath,
  getTabView,
  listMarkdownViews,
  markTabViewsReady,
  registerTabView
} from '@/plugins/registries/tabViews'
import type { Disposable, RendererPluginContext, TabViewContribution } from '@/plugins/types'
import type { IFileState } from '@shared/types/files'
import { resolveLocalLinkTarget } from 'main_renderer/filesystem'
import { getLocalLinkTabOptions } from 'common/filesystem/paths'

const ctx = { id: 'test-plugin', t: (key: string) => key } as unknown as RendererPluginContext
const Dummy = defineComponent({ render: () => null })

const pdfView: TabViewContribution = {
  id: 'pdf-view',
  kind: 'asset',
  extensions: ['pdf'],
  title: 'pdf.title',
  component: Dummy
}
const boardView: TabViewContribution = {
  id: 'board-view',
  kind: 'markdown',
  title: 'board.title',
  component: Dummy,
  matches: (markdown) => markdown.startsWith('---\nboard: true')
}

const registrations: Disposable[] = []
const register = (view: TabViewContribution): Disposable => {
  const disposable = registerTabView(ctx, view)
  registrations.push(disposable)
  return disposable
}

const markdownTab = (overrides: Partial<IFileState> = {}): IFileState =>
  createDocumentState({ pathname: '/vault/a.md', filename: 'a.md', markdown: 'alpha\n', ...overrides })

const addTabs = (
  store: { tabs: IFileState[]; updateTabIdToIndex(): void },
  ...tabs: IFileState[]
): void => {
  store.tabs = tabs
  store.updateTabIdToIndex()
}

const fileChangedPayloads = (emit: MockInstance): Array<Record<string, unknown>> =>
  emit.mock.calls
    .filter(([event]) => event === 'file-changed')
    .map(([, payload]) => payload as Record<string, unknown>)

beforeAll(() => {
  markTabViewsReady()
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

afterEach(() => {
  while (registrations.length) registrations.pop()!.dispose()
  vi.useRealTimers()
})

describe('tab view registry', () => {
  it('finds asset views by extension case-insensitively and markdown views by id', () => {
    register({ ...pdfView, extensions: ['.PDF'] })
    register(boardView)

    expect(getAssetViewForPath('/vault/Report.Final.PDF')?.view.id).toBe('pdf-view')
    expect(getAssetViewForPath('/vault/report.docx')).toBeNull()
    expect(getAssetViewForPath('/vault/pdf')).toBeNull()
    expect(getTabView('board-view')?.ctx).toBe(ctx)
    expect(listMarkdownViews().map((entry) => entry.view.id)).toEqual(['board-view'])
  })

  it('rejects a duplicate id and an asset view without extensions', () => {
    register(pdfView)
    expect(() => registerTabView(ctx, { ...pdfView, extensions: ['png'] })).toThrow(/already registered/)
    expect(() => registerTabView(ctx, { ...pdfView, id: 'other', extensions: [] })).toThrow(/no extension/)
  })

  it('lets the earliest registration win an extension and falls through on dispose', () => {
    const first = register(pdfView)
    register({ ...pdfView, id: 'pdf-view-2' })

    expect(getAssetViewForPath('/a.pdf')?.view.id).toBe('pdf-view')
    first.dispose()
    expect(getAssetViewForPath('/a.pdf')?.view.id).toBe('pdf-view-2')
    expect(getTabView('pdf-view')).toBeNull()
  })

  it('skips markdown views whose matches throws', () => {
    register({ ...boardView, id: 'broken', matches: () => { throw new Error('boom') } })
    register(boardView)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(findMatchingMarkdownView('---\nboard: true\n---\n')?.view.id).toBe('board-view')
    expect(findMatchingMarkdownView('# plain')).toBeNull()
  })
})

describe('asset tabs', () => {
  it('opens a registered asset in a tab that never reaches the editor engine', async() => {
    register(pdfView)
    const store = useEditorStore()
    const emit = vi.spyOn(bus, 'emit')

    const opened = await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf', subpath: 'page=3' })

    expect(opened).toBe(true)
    expect(store.tabs).toHaveLength(1)
    expect(store.currentFile).toMatchObject({
      kind: 'asset',
      viewId: 'pdf-view',
      subpath: 'page=3',
      filename: 'doc.pdf',
      markdown: '',
      isSaved: true
    })
    expect(fileChangedPayloads(emit)).toEqual([])
  })

  it('focuses an already open asset tab and hands it the new subpath', async() => {
    register(pdfView)
    const store = useEditorStore()
    const md = markdownTab()
    store.UPDATE_CURRENT_FILE(md)
    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf', subpath: 'page=3' })
    store.UPDATE_CURRENT_FILE(md)

    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf', subpath: 'page=7' })

    expect(store.tabs.filter((t) => t.kind === 'asset')).toHaveLength(1)
    expect(store.currentFile?.kind).toBe('asset')
    expect(store.currentFile?.subpath).toBe('page=7')
  })

  it('falls back to the OS default application when no view is registered', async() => {
    const store = useEditorStore()
    const openPath = vi.spyOn(window.electron.shell, 'openPath')

    const opened = await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf', subpath: 'page=3' })

    expect(opened).toBe(false)
    expect(openPath).toHaveBeenCalledWith('/vault/doc.pdf')
    expect(store.tabs).toHaveLength(0)
  })

  it('keeps the markdown tab state when switching through an asset tab', async() => {
    register(pdfView)
    const store = useEditorStore()
    const cursor = { anchor: { key: 'k', offset: 2 } }
    const history = { stack: [{ id: 4 }], index: 0 }
    const md = markdownTab({ cursor, history })
    store.UPDATE_CURRENT_FILE(md)
    store.listToc = [{ slug: 's', githubSlug: 's', lvl: 1 }]
    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf' })
    expect(store.listToc).toEqual([])

    const emit = vi.spyOn(bus, 'emit')
    store.UPDATE_CURRENT_FILE(md)

    const [payload] = fileChangedPayloads(emit)
    expect(payload).toMatchObject({ id: md.id, markdown: 'alpha\n', cursor, history })
  })

  it('ignores engine content changes and caret moves reported against an asset tab', async() => {
    register(pdfView)
    const store = useEditorStore()
    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf' })
    const asset = store.currentFile!

    store.LISTEN_FOR_CONTENT_CHANGE({ id: asset.id, markdown: 'leaked', history: { stack: [], index: -1 } })
    store.PERSIST_CURSOR(asset.id, { anchor: {} })

    expect(asset.markdown).toBe('')
    expect(asset.isSaved).toBe(true)
    expect(asset.cursor).toBeNull()
  })

  it('never prompts to save, autosaves or saves asset tabs', async() => {
    vi.useFakeTimers()
    register(pdfView)
    const store = useEditorStore()
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')
    const dirty = markdownTab({ isSaved: false, pathname: '/vault/dirty.md' })
    addTabs(store, dirty)
    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf' })

    store.FILE_SAVE()
    store.ASK_FOR_SAVE_ALL(false)
    vi.runAllTimers()

    expect(send.mock.calls.filter(([channel]) => channel === 'mt::response-file-save')).toEqual([])
    const saveTabs = send.mock.calls.find(([channel]) => channel === 'mt::save-tabs')
    expect((saveTabs?.[1] as Array<{ id: string }>).map((f) => f.id)).toEqual([dirty.id])
  })

  it('closes the window without a prompt when only asset tabs and saved tabs are open', async() => {
    register(pdfView)
    const listeners: Record<string, (...args: unknown[]) => void> = {}
    vi.spyOn(window.electron.ipcRenderer, 'on').mockImplementation(((
      channel: string,
      listener: (...args: unknown[]) => void
    ) => {
      listeners[channel] = listener
    }) as typeof window.electron.ipcRenderer.on)
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')
    const store = useEditorStore()
    addTabs(store, markdownTab())
    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf' })
    store.LISTEN_FOR_CLOSE()

    listeners['mt::ask-for-close']!()
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('mt::close-window'))
    expect(send.mock.calls.some(([channel]) => channel === 'mt::close-window-confirm')).toBe(false)
  })

  it('restores asset tabs as asset tabs and markdown views per tab', async() => {
    register(pdfView)
    register(boardView)
    const store = useEditorStore()
    addTabs(store, markdownTab({ viewId: 'board-view' }))
    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf', subpath: 'page=2' })

    const snapshot = JSON.parse(JSON.stringify(store.CREATE_BUFFERED_STATE()))
    setActivePinia(createPinia())
    const restored = useEditorStore()
    restored.RESTORE_BUFFERED_STATE(snapshot)

    expect(restored.tabs.map((t) => [t.kind, t.viewId, t.subpath])).toEqual([
      ['markdown', 'board-view', null],
      ['asset', 'pdf-view', 'page=2']
    ])
    expect(restored.currentFile?.kind).toBe('asset')
  })

  it('normalizes tampered buffered tab fields', () => {
    const asset = createDocumentState({ kind: 'asset', pathname: '/v/a.pdf', markdown: 'x', isSaved: false })
    const bogus = createDocumentState({ kind: 'binary', viewId: 3, subpath: 'page=1' } as never)

    expect([asset.markdown, asset.isSaved]).toEqual(['', true])
    expect([bogus.kind, bogus.viewId, bogus.subpath]).toEqual(['markdown', null, null])
  })
})

describe('markdown views', () => {
  it('auto-selects the matching view when a file is opened, not when it is edited', () => {
    register(boardView)
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { pathname: '/vault/board.md', filename: 'board.md', markdown: '---\nboard: true\n---\n' } as never
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { pathname: '/vault/note.md', filename: 'note.md', markdown: '# note' } as never
    })
    const note = store.currentFile!
    store.LISTEN_FOR_CONTENT_CHANGE({ id: note.id, markdown: '---\nboard: true\n---\n' })

    expect(store.tabs.map((t) => t.viewId)).toEqual(['board-view', null])
  })

  it('flushes the engine before entering a view and hands the result back as one handoff', () => {
    register(boardView)
    const store = useEditorStore()
    const tab = markdownTab({ muyaIndexCursor: { anchor: { line: 2, ch: 1 }, focus: { line: 2, ch: 1 } } })
    store.UPDATE_CURRENT_FILE(tab)
    const order: string[] = []
    const emit = vi.spyOn(bus, 'emit').mockImplementation(((event: string) => {
      order.push(`${event}:${tab.viewId}`)
    }) as typeof bus.emit)

    store.SET_TAB_VIEW(tab.id, 'board-view')
    // The view writes without engine history: dirtiness is a text comparison.
    store.LISTEN_FOR_CONTENT_CHANGE({ id: tab.id, markdown: 'beta\n' })
    // A late engine change (it carries history) must not clobber the view's text.
    store.LISTEN_FOR_CONTENT_CHANGE({ id: tab.id, markdown: 'stale\n', history: { stack: [], index: -1 } })
    expect([tab.markdown, tab.isSaved]).toEqual(['beta\n', false])

    store.SET_TAB_VIEW(tab.id, null)

    expect(order[0]).toBe('flush-active-editor:null')
    const handoff = fileChangedPayloads(emit).at(-1)!
    expect(handoff).toEqual({
      id: tab.id,
      markdown: 'beta\n',
      muyaIndexCursor: { anchor: { line: 2, ch: 1 }, focus: { line: 2, ch: 1 } },
      renderCursor: true
    })
  })

  it('hands back at the document start when no source caret was captured', () => {
    register(boardView)
    const store = useEditorStore()
    const tab = markdownTab({ viewId: 'board-view' })
    store.UPDATE_CURRENT_FILE(tab)
    const emit = vi.spyOn(bus, 'emit')

    store.SET_TAB_VIEW(tab.id, null)

    expect(fileChangedPayloads(emit)[0]!.muyaIndexCursor).toEqual({
      anchor: { line: 0, ch: 0 },
      focus: { line: 0, ch: 0 }
    })
  })

  it('refuses unknown and asset views', () => {
    register(pdfView)
    const store = useEditorStore()
    const tab = markdownTab()
    store.UPDATE_CURRENT_FILE(tab)

    store.SET_TAB_VIEW(tab.id, 'pdf-view')
    store.SET_TAB_VIEW(tab.id, 'missing')

    expect(tab.viewId).toBeNull()
  })

  it('keeps the chosen view across an external reload', () => {
    register(boardView)
    const store = useEditorStore()
    const tab = markdownTab({ viewId: 'board-view' })
    addTabs(store, tab)

    store.loadChange({ pathname: '/vault/a.md', data: { markdown: 'reloaded\n', filename: 'a.md' } })

    expect([tab.markdown, tab.viewId, tab.kind]).toEqual(['reloaded\n', 'board-view', 'markdown'])
  })
})

describe('UPDATE_TAB_MARKDOWN_BY_PATH', () => {
  it('returns false when no markdown tab shows the file', async() => {
    register(pdfView)
    const store = useEditorStore()
    addTabs(store, markdownTab())
    await store.OPEN_ASSET_TAB({ pathname: '/vault/doc.pdf' })

    expect(store.UPDATE_TAB_MARKDOWN_BY_PATH('/vault/other.md', 'x')).toBe(false)
    expect(store.UPDATE_TAB_MARKDOWN_BY_PATH('/vault/doc.pdf', 'x')).toBe(false)
  })

  it('makes the active tab unsaved and reloads the editor as an undoable edit', () => {
    const store = useEditorStore()
    const tab = markdownTab()
    store.UPDATE_CURRENT_FILE(tab)
    const emit = vi.spyOn(bus, 'emit')

    expect(store.UPDATE_TAB_MARKDOWN_BY_PATH('/vault/a.md', 'alpha [[b]]\n')).toBe(true)

    expect([tab.markdown, tab.isSaved, tab.wordCount.word]).toEqual(['alpha [[b]]\n', false, 2])
    expect(fileChangedPayloads(emit)).toEqual([
      expect.objectContaining({
        id: tab.id,
        markdown: 'alpha [[b]]\n',
        isReload: true,
        keepSavedBaseline: true
      })
    ])
  })

  it('leaves the engine alone while a markdown view owns the text', () => {
    register(boardView)
    const store = useEditorStore()
    const tab = markdownTab({ viewId: 'board-view' })
    store.UPDATE_CURRENT_FILE(tab)
    const emit = vi.spyOn(bus, 'emit')

    store.UPDATE_TAB_MARKDOWN_BY_PATH('/vault/a.md', 'beta\n')

    expect([tab.markdown, tab.isSaved]).toEqual(['beta\n', false])
    expect(fileChangedPayloads(emit)).toEqual([])
  })

  it('replays a background edit on activation on top of the content the engine history ends at', () => {
    const store = useEditorStore()
    const background = markdownTab({ pathname: '/vault/b.md', filename: 'b.md', markdown: 'one\n' })
    const active = markdownTab()
    store.UPDATE_CURRENT_FILE(background)
    store.UPDATE_CURRENT_FILE(active)

    store.UPDATE_TAB_MARKDOWN_BY_PATH('/vault/b.md', 'two\n')
    store.UPDATE_TAB_MARKDOWN_BY_PATH('/vault/b.md', 'three\n')
    const emit = vi.spyOn(bus, 'emit')
    store.UPDATE_CURRENT_FILE(background)

    expect(fileChangedPayloads(emit).map((p) => [p.markdown, p.isReload ?? false])).toEqual([
      ['one\n', false],
      ['three\n', true]
    ])

    emit.mockClear()
    store.UPDATE_CURRENT_FILE(active)
    store.UPDATE_CURRENT_FILE(background)
    expect(fileChangedPayloads(emit).at(-1)).toMatchObject({ markdown: 'three\n' })
    expect(fileChangedPayloads(emit).at(-1)!.isReload).toBeUndefined()
  })
})

describe('markdown views registered after the file opened', () => {
  it('applies matches once the plugin host reports the initial registrations', async() => {
    // Fresh module instances: the readiness latch is module state and the
    // suite above already released it.
    vi.resetModules()
    const registry = await import('@/plugins/registries/tabViews')
    const { useEditorStore: useFreshEditorStore } = await import('@/store/editor')
    setActivePinia(createPinia())
    const store = useFreshEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { pathname: '/vault/board.md', filename: 'board.md', markdown: '---\nboard: true\n---\n' } as never
    })
    const tab = store.currentFile!
    expect(tab.viewId).toBeNull()

    const disposable = registry.registerTabView(ctx, boardView)
    registry.markTabViewsReady()
    await vi.waitFor(() => expect(tab.viewId).toBe('board-view'))
    disposable.dispose()
  })
})

describe('local link routing', () => {
  let dir: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-asset-link-'))
    fs.writeFileSync(path.join(dir, 'doc.pdf'), '%PDF-1.7')
    fs.writeFileSync(path.join(dir, 'note.md'), '# note')
    fs.writeFileSync(path.join(dir, 'sheet.docx'), '')
    fs.writeFileSync(path.join(dir, 'run.sh'), 'echo hi')
    fs.symlinkSync(path.join(dir, 'run.sh'), path.join(dir, 'fake.pdf'))
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const route = (link: string) => {
    const { pathname, anchor } = resolveLocalLinkTarget(link, dir)
    return getLocalLinkTabOptions(pathname, anchor)
  }

  it('opens a PDF link in a tab and passes the fragment as the view subpath', () => {
    expect(resolveLocalLinkTarget('doc.pdf#page=3', dir)).toEqual({
      pathname: path.join(dir, 'doc.pdf'),
      anchor: 'page=3'
    })
    expect(route('doc.pdf#page=3')).toEqual({ subpath: 'page=3' })
    expect(route('doc.pdf')).toEqual({})
  })

  it('keeps markdown fragments as heading anchors and sends other files to the OS', () => {
    expect(route('note.md#intro')).toEqual({ anchor: 'intro' })
    expect(route('sheet.docx')).toBeNull()
    expect(route('missing.pdf')).toBeNull()
  })

  it('judges a symbolic link by its target', () => {
    expect(route('fake.pdf')).toBeNull()
  })
})
