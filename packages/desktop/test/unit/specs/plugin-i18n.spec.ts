import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PluginLocales } from '@shared/plugins/types'
import { buildPluginMessages, resolvePluginMessages } from '@/plugins/host/i18n'

const LOCALES: PluginLocales = {
  en: { panel: { title: 'Calendar', today: 'Today' }, count: '{n} notes' },
  pt: { panel: { title: 'Calendário' } }
}

describe('plugin message merge', () => {
  it('overlays the language bundle on English key by key', () => {
    expect(resolvePluginMessages(LOCALES, 'pt')).toEqual({
      panel: { title: 'Calendário', today: 'Today' },
      count: '{n} notes'
    })
  })

  it('uses English for languages the plugin does not ship', () => {
    expect(resolvePluginMessages(LOCALES, 'ja')).toEqual(LOCALES.en)
  })

  it('nests every plugin under plugins.<id>', () => {
    const messages = buildPluginMessages(new Map([['calendar', LOCALES]]), 'pt')
    expect(Object.keys(messages)).toEqual(['plugins'])
    expect(messages.plugins.calendar).toEqual(resolvePluginMessages(LOCALES, 'pt'))
  })
})

type IpcHandler = (event: unknown, ...args: unknown[]) => void

const win = window as unknown as {
  electron?: { ipcRenderer: { on: (channel: string, handler: IpcHandler) => () => void; send: () => void } }
  i18nUtils?: { loadTranslations: (locale: string) => Promise<Record<string, unknown>> }
}

// The i18n module subscribes to IPC language events when it loads, so each
// case imports a fresh copy (after `vi.resetModules`) with the mocked bridge.
describe('renderer i18n with plugin strings', () => {
  let handlers: Map<string, IpcHandler>
  let resolveLoad: ((messages: Record<string, unknown>) => void) | null

  beforeEach(() => {
    vi.resetModules()
    handlers = new Map()
    resolveLoad = null
    win.electron = {
      ipcRenderer: {
        on: (channel, handler) => {
          handlers.set(channel, handler)
          return () => handlers.delete(channel)
        },
        send: () => {}
      }
    }
    win.i18nUtils = {
      loadTranslations: vi.fn(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            resolveLoad = resolve
          })
      )
    }
  })

  afterEach(() => {
    delete win.electron
    delete win.i18nUtils
  })

  it('translates plugin keys with parameters and English fallback in other languages', async() => {
    const i18n = await import('@/i18n')
    i18n.registerPluginLocales('calendar', LOCALES)
    expect(i18n.translatePluginKey('calendar', 'panel.title')).toBe('Calendar')
    expect(i18n.translatePluginKey('calendar', 'count', { n: 3 })).toBe('3 notes')
    expect(i18n.translatePluginKey('calendar', 'missing.key')).toBe('missing.key')

    const switching = i18n.setLanguage('pt')
    resolveLoad!({ menu: {} })
    await switching
    expect(i18n.translatePluginKey('calendar', 'panel.title')).toBe('Calendário')
    expect(i18n.translatePluginKey('calendar', 'panel.today')).toBe('Today')
  })

  it('merges plugins registered after a language was loaded', async() => {
    const i18n = await import('@/i18n')
    const switching = i18n.setLanguage('pt')
    resolveLoad!({ menu: {} })
    await switching
    i18n.registerPluginLocales('calendar', LOCALES)
    expect(i18n.translatePluginKey('calendar', 'panel.title')).toBe('Calendário')
  })

  it('announces a language change only after its messages are active, even on the first switch', async() => {
    const i18n = await import('@/i18n')
    const { default: bus } = await import('@/bus')
    i18n.registerPluginLocales('calendar', LOCALES)
    const seen: Array<[unknown, string, string]> = []
    bus.on('language-changed', (language) => {
      seen.push([language, i18n.getCurrentLanguage(), i18n.translatePluginKey('calendar', 'panel.title')])
    })

    handlers.get('language-changed')!({}, 'pt')
    await Promise.resolve()
    expect(seen).toEqual([])

    resolveLoad!({ menu: {} })
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual(['pt', 'pt', 'Calendário'])
  })
})
