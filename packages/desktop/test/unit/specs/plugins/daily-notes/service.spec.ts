import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { PluginSettingValue } from '@shared/plugins/types'
import type { ActiveTabInfo, RendererPluginContext } from '@/plugins/types'
import type { NoteFileInfo, NotesResponse } from '@plugins/daily-notes/common/noteIndex'
import { DailyNotesService } from '@plugins/daily-notes/renderer/service'

interface Harness {
  service: DailyNotesService
  files: Map<string, string>
  opened: string[]
  created: Array<{ path: string; content: string }>
  notices: Array<{ type?: string; message: string }>
  setActive(pathname: string | null): void
}

const DEFAULTS: Record<string, PluginSettingValue> = {
  folder: '',
  format: 'YYYY-MM-DD',
  template: '',
  weekStart: 'sunday',
  openOnStartup: false
}

// An in-memory vault behind the parts of the plugin context the service uses.
const createHarness = (options: {
  root?: string | null
  settings?: Record<string, PluginSettingValue>
  files?: Record<string, string>
  notes?: NoteFileInfo[]
}): Harness => {
  const root = options.root === undefined ? '/vault' : options.root
  const files = new Map(Object.entries(options.files ?? {}))
  const settings = { ...DEFAULTS, ...options.settings }
  const opened: string[] = []
  const created: Array<{ path: string; content: string }> = []
  const notices: Array<{ type?: string; message: string }> = []
  let active: ActiveTabInfo | null = null
  const noop = { dispose: () => {} }
  const ctx = {
    id: 'daily-notes',
    language: ref('en'),
    t: (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    track: <T>(disposable: T) => disposable,
    ui: { notify: (notice: { type?: string; message: string }) => notices.push(notice) },
    editor: { getActiveTab: () => active },
    settings: {
      get: (key: string) => settings[key],
      onDidChange: () => noop
    },
    workspace: {
      getRootPath: () => root,
      onDidChangeRootPath: () => noop,
      openFile: async(path: string) => {
        opened.push(path)
      },
      createAndOpenFile: async(path: string, content: string) => {
        files.set(path, content)
        created.push({ path, content })
      }
    },
    vault: {
      exists: async(path: string) => files.has(path),
      readText: async(path: string) => {
        const content = files.get(path)
        if (content === undefined) throw new Error('NOT_FOUND')
        return { content, mtimeMs: 1 }
      }
    },
    metadata: {
      onDidBecomeReady: () => noop,
      onDidChange: () => noop,
      request: async(): Promise<NotesResponse> => ({ rootPath: root ?? '', notes: options.notes ?? [] })
    }
  } as unknown as RendererPluginContext
  const service = new DailyNotesService(ctx)
  service.start()
  return {
    service,
    files,
    opened,
    created,
    notices,
    setActive: (pathname) => {
      active = pathname
        ? { id: '1', pathname, filename: pathname.split('/').pop() ?? '', isSaved: true, kind: 'markdown', viewId: null }
        : null
    }
  }
}

describe('DailyNotesService.openDate', () => {
  it('creates a missing note at the configured path from the template', async() => {
    const harness = createHarness({
      settings: { folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD', template: 'Templates/Daily' },
      files: { '/vault/Templates/Daily.md': '# {{title}}\n\n[[{{yesterday}}]] · {{date:dddd}}\n' }
    })
    await harness.service.openDate('2026-10-04')
    expect(harness.created).toEqual([
      { path: '/vault/Journal/2026/10/2026-10-04.md', content: '# 2026-10-04\n\n[[2026/10/2026-10-03]] · Sunday\n' }
    ])
    expect(harness.notices).toEqual([])
  })

  it('opens an existing note instead of recreating it', async() => {
    const harness = createHarness({ files: { '/vault/2026-10-04.md': 'kept' } })
    await harness.service.openDate('2026-10-04')
    expect(harness.opened).toEqual(['/vault/2026-10-04.md'])
    expect(harness.created).toEqual([])
    expect(harness.files.get('/vault/2026-10-04.md')).toBe('kept')
  })

  it('opens a daily note found elsewhere when the configured path is free', async() => {
    const harness = createHarness({
      settings: { folder: 'Daily' },
      notes: [{ path: '/vault/Archive/2026-10-04.md', day: '2026-10-04', wordCount: 5 }]
    })
    await harness.service.refresh()
    await harness.service.openDate('2026-10-04')
    expect(harness.opened).toEqual(['/vault/Archive/2026-10-04.md'])
    expect(harness.created).toEqual([])
  })

  it('creates an empty note and warns when the template cannot be read', async() => {
    const harness = createHarness({ settings: { template: 'Templates/Missing' } })
    await harness.service.openDate('2026-10-04')
    expect(harness.created).toEqual([{ path: '/vault/2026-10-04.md', content: '' }])
    expect(harness.notices).toEqual([
      { type: 'warning', message: 'notify.templateMissing {"path":"Templates/Missing.md"}' }
    ])
  })

  it('does nothing but notify without an opened folder', async() => {
    const harness = createHarness({ root: null })
    await harness.service.openToday()
    expect(harness.opened).toEqual([])
    expect(harness.created).toEqual([])
    expect(harness.notices).toEqual([{ type: 'warning', message: 'notify.noFolder' }])
  })
})

describe('DailyNotesService.openAdjacent', () => {
  const notes: NoteFileInfo[] = [
    { path: '/vault/Daily/2026-10-01.md', day: '2026-10-01', wordCount: 10 },
    { path: '/vault/Daily/2026-10-03.md', day: '2026-10-03', wordCount: 10 },
    { path: '/vault/Home.md', day: null, wordCount: 10 }
  ]

  it('skips days without a note', async() => {
    const harness = createHarness({ settings: { folder: 'Daily' }, notes })
    harness.setActive('/vault/Daily/2026-10-03.md')
    await harness.service.openAdjacent(-1)
    harness.setActive('/vault/Daily/2026-10-01.md')
    await harness.service.openAdjacent(1)
    expect(harness.opened).toEqual(['/vault/Daily/2026-10-01.md', '/vault/Daily/2026-10-03.md'])
  })

  it('reports the ends of the list and non-daily notes', async() => {
    const harness = createHarness({ settings: { folder: 'Daily' }, notes })
    harness.setActive('/vault/Daily/2026-10-01.md')
    await harness.service.openAdjacent(-1)
    harness.setActive('/vault/Home.md')
    await harness.service.openAdjacent(1)
    expect(harness.opened).toEqual([])
    expect(harness.notices.map((notice) => notice.message)).toEqual(['notify.noPrevious', 'notify.notDailyNote'])
  })
})
