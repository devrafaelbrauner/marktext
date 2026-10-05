import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUFFER_PATH, matchesAccelerator } from '../src/main/editorWindow'
import { registerI18n } from '../src/main/i18n'
import { rendererIpc } from '../src/main/ipc'
import { getRootPath } from '../src/main/state'
import { ROOT, createCore, flush, recordPushes } from './helpers'

const SAVE_OPTIONS = {
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 1
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('startup', () => {
  it('bootstraps a blank tab when there is nothing to open', async() => {
    const { editor } = await createCore({}, { startUpAction: 'openLastFolder' })
    const pushed = recordPushes(['mt::bootstrap-editor', 'mt::open-directory'])
    await editor.startup()
    await flush()
    expect(pushed).toEqual([
      [
        'mt::bootstrap-editor',
        {
          addBlankTab: true,
          markdownList: [],
          lineEnding: 'lf',
          sideBarVisibility: false,
          tabBarVisibility: false,
          sourceCodeModeEnabled: false
        }
      ]
    ])
  })

  it('holds the bootstrap until the renderer has the UI language, so the first tab is named in it', async() => {
    registerI18n()
    const { editor } = await createCore({}, { startUpAction: 'openLastFolder', language: 'pt' })
    const pushed = recordPushes(['mt::bootstrap-editor'])
    const started = editor.startup()
    await flush()
    expect(pushed).toEqual([])
    const translations = (await rendererIpc.invoke('mt::i18n::load', 'pt')) as { editor: { untitled: string } }
    expect(translations.editor.untitled).toBe('Sem título')
    await started
    await flush()
    expect(pushed.map(([channel]) => channel)).toEqual(['mt::bootstrap-editor'])
  })

  it('reopens the last folder while it is still reachable, then populates the tree', async() => {
    const { editor } = await createCore(
      { [`${ROOT}/a.md`]: 'a', [`${ROOT}/sub/b.md`]: 'b' },
      { startUpAction: 'openLastFolder', lastOpenedFolder: ROOT, restoreLayoutState: true, sideBarVisibility: true }
    )
    const pushed = recordPushes(['mt::bootstrap-editor', 'mt::open-directory', 'mt::update-object-tree', 'mt::user-preference'])
    await editor.startup()
    await flush()
    expect(pushed.map(([channel]) => channel)).toEqual([
      'mt::bootstrap-editor',
      'mt::open-directory',
      'mt::update-object-tree',
      'mt::update-object-tree',
      'mt::update-object-tree'
    ])
    expect(pushed[0]?.[1]).toMatchObject({ addBlankTab: false, sideBarVisibility: true })
    expect(pushed[1]?.[1]).toBe(ROOT)
    expect(getRootPath()).toBe(ROOT)
  })

  it('does not reopen a folder whose grant is gone', async() => {
    const { editor } = await createCore({}, { startUpAction: 'openLastFolder', lastOpenedFolder: '/vault/dead0000/Gone' })
    const pushed = recordPushes(['mt::bootstrap-editor', 'mt::open-directory'])
    await editor.startup()
    await flush()
    expect(pushed.map(([channel]) => channel)).toEqual(['mt::bootstrap-editor'])
    expect(pushed[0]?.[1]).toMatchObject({ addBlankTab: true })
  })

  it('restores the buffer: refreshes saved tabs from disk, keeps unsaved edits, flags missing files', async() => {
    const state = {
      version: 1,
      tabs: [
        { id: 't1', filename: 'a.md', pathname: `${ROOT}/a.md`, markdown: 'stale', isSaved: true },
        { id: 't2', filename: 'b.md', pathname: `${ROOT}/b.md`, markdown: 'my edit', isSaved: false },
        { id: 't3', filename: 'gone.md', pathname: `${ROOT}/gone.md`, markdown: 'x', isSaved: true }
      ],
      currentFileId: 't1',
      project: { rootDirectory: ROOT }
    }
    const { editor } = await createCore(
      { [`${ROOT}/a.md`]: 'fresh', [`${ROOT}/b.md`]: 'disk', [BUFFER_PATH]: JSON.stringify(state) },
      { startUpAction: 'restoreAll' }
    )
    const pushed = recordPushes(['mt::bootstrap-editor', 'mt::open-directory', 'mt::load-state', 'mt::show-notification'])
    await editor.startup()
    await flush()
    expect(pushed.map(([channel]) => channel)).toEqual([
      'mt::bootstrap-editor',
      'mt::open-directory',
      'mt::show-notification',
      'mt::load-state'
    ])
    const restored = pushed[3]?.[1] as typeof state
    expect(restored.tabs.map((tab) => [tab.markdown, tab.isSaved])).toEqual([
      ['fresh', true],
      ['my edit', false],
      ['x', false]
    ])
    expect(pushed[0]?.[1]).toMatchObject({ addBlankTab: false })
  })
})

describe('open', () => {
  it('opens a markdown file as a new tab, then switches to it when open again', async() => {
    const { editor } = await createCore({ [`${ROOT}/a.md`]: 'line\r\n' })
    await editor.openFolder(ROOT)
    const pushed = recordPushes(['mt::open-new-tab', 'mt::switch-tab-by-file_path'])
    await editor.openTab(`${ROOT}/a.md`, { anchor: 'x' }, true)
    await editor.openTab(`${ROOT}/a.md`, {}, true)
    await flush()
    expect(pushed[0]).toEqual([
      'mt::open-new-tab',
      {
        markdown: 'line\n',
        filename: 'a.md',
        pathname: `${ROOT}/a.md`,
        encoding: { encoding: 'utf8', isBom: false },
        lineEnding: 'crlf',
        adjustLineEndingOnSave: true,
        trimTrailingNewline: 1,
        isMixedLineEndings: false
      },
      { anchor: 'x' },
      true
    ])
    expect(pushed[1]).toEqual(['mt::switch-tab-by-file_path', `${ROOT}/a.md`, {}])
  })

  it('hands PDFs to an asset tab', async() => {
    const { editor } = await createCore({ [`${ROOT}/book.pdf`]: '%PDF' })
    await editor.openFolder(ROOT)
    const pushed = recordPushes(['mt::open-asset-tab'])
    await editor.openTab(`${ROOT}/book.pdf`, { subpath: 'page=3' }, true)
    await flush()
    expect(pushed).toEqual([['mt::open-asset-tab', { pathname: `${ROOT}/book.pdf`, subpath: 'page=3' }, true]])
  })

  it('refuses files outside the scope with a notification', async() => {
    const { editor } = await createCore({ '/data/marktext/secret.md': 'no' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pushed = recordPushes(['mt::open-new-tab', 'mt::show-notification'])
    await editor.openTab('/data/marktext/secret.md', {}, true)
    await flush()
    expect(pushed.map(([channel]) => channel)).toEqual(['mt::show-notification'])
    expect(pushed[0]?.[1]).toMatchObject({ title: 'Cannot open file', type: 'error' })
  })
})

describe('save', () => {
  it('writes an existing file with its line ending and BOM, then reports tab-saved', async() => {
    const { editor, backend } = await createCore({ [`${ROOT}/a.md`]: 'old' })
    await editor.openFolder(ROOT)
    const pushed = recordPushes(['mt::tab-saved', 'mt::set-pathname', 'mt::tab-save-failure'])
    const id = await editor.save({
      id: 'tab-1',
      filename: 'a.md',
      pathname: `${ROOT}/a.md`,
      markdown: 'new\ntext\n',
      options: { ...SAVE_OPTIONS, lineEnding: 'crlf', adjustLineEndingOnSave: true, encoding: { encoding: 'utf8', isBom: true } },
      defaultPath: ROOT
    })
    await flush()
    expect(id).toBe('tab-1')
    expect(pushed).toEqual([['mt::tab-saved', 'tab-1']])
    expect(await backend.readFile(`${ROOT}/a.md`)).toEqual(
      Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('new\r\ntext\r\n')])
    )
  })

  it('asks for a location for an untitled tab and reports the new path', async() => {
    const { editor, backend } = await createCore()
    await editor.openFolder(ROOT)
    backend.pickQueue.push({ path: `${ROOT}/My Title.md`, name: 'My Title.md' })
    const picker = vi.spyOn(backend, 'pickSaveFile')
    const pushed = recordPushes(['mt::tab-saved', 'mt::set-pathname'])
    await editor.save({ id: 'u1', filename: 'Untitled-1', pathname: '', markdown: '# My Title\n', options: SAVE_OPTIONS, defaultPath: ROOT })
    await flush()
    expect(picker).toHaveBeenCalledWith('My Title.md', 'text/markdown', ROOT)
    expect(pushed).toEqual([['mt::set-pathname', { id: 'u1', pathname: `${ROOT}/My Title.md`, filename: 'My Title.md' }]])
    expect(await backend.readText(`${ROOT}/My Title.md`)).toBe('# My Title\n')
  })

  it('does nothing when the picker is cancelled', async() => {
    const { editor } = await createCore()
    const pushed = recordPushes(['mt::tab-saved', 'mt::set-pathname', 'mt::tab-save-failure'])
    expect(await editor.save({ id: 'u1', filename: 'Untitled-1', pathname: '', markdown: 'x', options: SAVE_OPTIONS })).toBeNull()
    await flush()
    expect(pushed).toEqual([])
  })

  it('reports an encoding Android cannot write as a save failure and keeps the file', async() => {
    const { editor, backend } = await createCore({ [`${ROOT}/a.md`]: 'old' })
    await editor.openFolder(ROOT)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pushed = recordPushes(['mt::tab-saved', 'mt::tab-save-failure'])
    await editor.save({
      id: 't',
      filename: 'a.md',
      pathname: `${ROOT}/a.md`,
      markdown: 'x',
      options: { ...SAVE_OPTIONS, encoding: { encoding: 'shiftjis', isBom: false } }
    })
    await flush()
    expect(pushed).toEqual([['mt::tab-save-failure', 't', expect.stringMatching(/shiftjis/)]])
    expect(await backend.readText(`${ROOT}/a.md`)).toBe('old')
  })

  it('refuses to write outside the scope', async() => {
    const { editor, backend } = await createCore({ '/data/marktext/preferences.json': '{}' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pushed = recordPushes(['mt::tab-save-failure'])
    await editor.save({ id: 't', filename: 'p', pathname: '/data/marktext/preferences.json', markdown: 'pwned', options: SAVE_OPTIONS })
    await flush()
    expect(pushed).toHaveLength(1)
    expect(await backend.readText('/data/marktext/preferences.json')).not.toBe('pwned')
  })

  it('updates the sidebar after the save, once the reply settled', async() => {
    const { editor } = await createCore()
    await editor.openFolder(ROOT)
    await editor.idle()
    const pushed = recordPushes(['mt::update-object-tree'])
    await editor.save({ id: 'n', filename: 'n.md', pathname: `${ROOT}/n.md`, markdown: 'n', options: SAVE_OPTIONS })
    expect(pushed).toEqual([])
    await editor.idle()
    await flush()
    expect(pushed.map(([, event]) => (event as { type: string }).type)).toEqual(['add'])
  })
})

describe('rename and external changes', () => {
  it('renames a document and reports the old path', async() => {
    const { editor, backend } = await createCore({ [`${ROOT}/a.md`]: 'a' })
    await editor.openFolder(ROOT)
    await editor.idle()
    const pushed = recordPushes(['mt::set-pathname', 'mt::update-object-tree'])
    await editor.rename('t', `${ROOT}/a.md`, `${ROOT}/b.md`)
    await editor.idle()
    await flush()
    expect(pushed[0]).toEqual(['mt::set-pathname', { id: 't', pathname: `${ROOT}/b.md`, filename: 'b.md', oldPathname: `${ROOT}/a.md` }])
    expect(pushed.slice(1).map(([, event]) => (event as { type: string }).type)).toEqual(['unlink', 'add'])
    expect(await backend.stat(`${ROOT}/a.md`)).toBeNull()
  })

  it('asks before replacing an existing file', async() => {
    const { editor, backend } = await createCore({ [`${ROOT}/a.md`]: 'a', [`${ROOT}/b.md`]: 'b' })
    await editor.openFolder(ROOT)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const pushed = recordPushes(['mt::set-pathname'])
    await editor.rename('t', `${ROOT}/a.md`, `${ROOT}/b.md`)
    await flush()
    expect(confirm).toHaveBeenCalledOnce()
    expect(pushed).toEqual([])
    expect(await backend.readText(`${ROOT}/b.md`)).toBe('b')
  })

  it('pushes mt::update-file when another app changes or removes an open document', async() => {
    const { editor, backend } = await createCore({ [`${ROOT}/a.md`]: 'v1\n' })
    await editor.openFolder(ROOT)
    await editor.openTab(`${ROOT}/a.md`, {}, true)
    const pushed = recordPushes(['mt::update-file'])
    await editor.checkExternalChanges(false)
    backend.put(`${ROOT}/a.md`, 'v2\n')
    await editor.checkExternalChanges(false)
    await backend.remove(`${ROOT}/a.md`)
    await editor.checkExternalChanges(false)
    await editor.checkExternalChanges(false)
    await flush()
    expect(pushed.map(([, payload]) => (payload as { type: string }).type)).toEqual(['change', 'unlink'])
    expect(pushed[0]?.[1]).toMatchObject({ change: { pathname: `${ROOT}/a.md`, data: { markdown: 'v2\n' } } })
  })

  it('does not report its own saves as external changes', async() => {
    const { editor } = await createCore({ [`${ROOT}/a.md`]: 'v1' })
    await editor.openFolder(ROOT)
    await editor.openTab(`${ROOT}/a.md`, {}, true)
    await editor.save({ id: 't', filename: 'a.md', pathname: `${ROOT}/a.md`, markdown: 'v2', options: SAVE_OPTIONS })
    const pushed = recordPushes(['mt::update-file'])
    await editor.checkExternalChanges(false)
    await flush()
    expect(pushed).toEqual([])
  })
})

describe('matchesAccelerator', () => {
  const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init)

  it('matches modifiers exactly', () => {
    expect(matchesAccelerator(key({ key: 's', ctrlKey: true }), 'Ctrl+S')).toBe(true)
    expect(matchesAccelerator(key({ key: 'S', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+S')).toBe(true)
    expect(matchesAccelerator(key({ key: 'S', ctrlKey: true, shiftKey: true }), 'Ctrl+S')).toBe(false)
    expect(matchesAccelerator(key({ key: 's', ctrlKey: true }), 'CmdOrCtrl+S')).toBe(true)
    expect(matchesAccelerator(key({ key: 's' }), 'Ctrl+S')).toBe(false)
  })
})
