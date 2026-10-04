import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed, defineComponent } from 'vue'
import type { PluginHostState, PluginManifest } from '@shared/plugins/types'
import type { CommandDescriptor } from '@/commands'
import { PluginManager, type RendererPluginEntry } from '@/plugins/host/manager'
import { createPluginContext, type PluginHostServices } from '@/plugins/host/context'
import { EngineHost, type EngineInstance, type EngineRegistries } from '@/plugins/host/engine'
import { PluginKeybindings } from '@/plugins/host/keybindings'
import { PluginStateClient, type PluginsBridge } from '@/plugins/host/pluginState'
import { listSidebarPanels, sanitizeSvgIcon } from '@/plugins/registries/sidebarPanels'
import { listStatusBarItems } from '@/plugins/registries/statusBar'
import type { RendererPluginContext, RendererPluginModule } from '@/plugins/types'

const Panel = defineComponent({ render: () => null })

const manifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({
  id,
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  ...extra
})

const stateWith = (enabled: Record<string, boolean>, extra: Partial<PluginHostState> = {}): PluginHostState => ({
  safeMode: false,
  enabled,
  settings: {},
  secretsSet: {},
  ...extra
})

const flush = async(): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const createFakeMuya = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    listeners,
    emit: (event: string, payload?: unknown) => listeners.get(event)?.forEach((l) => l(payload)),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.get(event)?.delete(listener)),
    setOptions: vi.fn(),
    setDecorations: vi.fn(),
    clearDecorations: vi.fn(),
    replaceRange: vi.fn(() => true),
    getCheckableBlocks: vi.fn(() => []),
    insertText: vi.fn(() => true),
    refreshInlineRendering: vi.fn()
  }
}

const createHarness = (initial: PluginHostState) => {
  let pushState: ((state: PluginHostState) => void) | null = null
  const bridge: PluginsBridge = {
    getState: async() => initial,
    setEnabled: vi.fn(),
    setSetting: vi.fn(),
    setSecret: vi.fn(),
    onStateChanged: (handler) => {
      pushState = handler
      return () => {
        pushState = null
      }
    }
  }
  const stateClient = new PluginStateClient(bridge)

  const unregister = { inline: vi.fn(), codeBlock: vi.fn(), completion: vi.fn() }
  const registries: EngineRegistries = {
    registerInlineSyntax: vi.fn(() => unregister.inline),
    registerCodeBlockRenderer: vi.fn(() => unregister.codeBlock),
    registerCompletionProvider: vi.fn(() => unregister.completion)
  }
  const muya = createFakeMuya()
  const engine = new EngineHost({ getActiveTabId: () => 'tab-1', isMac: false, registries })
  engine.attach(muya as unknown as EngineInstance)

  const subcommands: CommandDescriptor[] = []
  const commandCenter = {
    rootCommand: { subcommands },
    REGISTER_COMMAND: (command: CommandDescriptor, describe?: () => string) => {
      if (describe) command.description = describe()
      subcommands.push(command)
    },
    UNREGISTER_COMMAND: (id: string) => {
      const index = subcommands.findIndex((c) => c.id === id)
      if (index !== -1) subcommands.splice(index, 1)
    },
    SORT_COMMANDS: () => {}
  }
  const keyTarget = new EventTarget()
  const keybindingLog = vi.fn()
  const keybindings = new PluginKeybindings(keyTarget, false, keybindingLog)

  const eventListeners = new Set<(id: string, event: string, payload: unknown) => void>()
  const tabViewDisposals = vi.fn()
  const services: PluginHostServices = {
    engine,
    vault: {} as PluginHostServices['vault'],
    metadata: {} as PluginHostServices['metadata'],
    stateClient,
    commands: { commandCenter, keybindings, isMac: false, reportError: vi.fn() },
    bridge: {
      invoke: vi.fn(async() => ({ ok: true as const, value: 'pong' })),
      onEvent: (handler) => {
        eventListeners.add(handler)
        return () => eventListeners.delete(handler)
      }
    },
    language: computed(() => 'en'),
    translate: (id, key) => `${id}:${key}`,
    getActiveTab: () => null,
    onDidChangeActiveTab: () => ({ dispose: () => {} }),
    getMarkdown: () => null,
    getRootPath: () => null,
    onDidChangeRootPath: () => ({ dispose: () => {} }),
    openFile: vi.fn(async() => {}),
    registerTabView: vi.fn(() => ({ dispose: tabViewDisposals })),
    revealSidebarPanel: vi.fn(),
    onSidebarPanelRemoved: vi.fn(),
    notify: vi.fn(),
    openSettings: vi.fn(),
    log: vi.fn()
  }
  const reportActivationError = vi.fn()
  const refreshParsing = vi.fn()
  const createManager = (plugins: RendererPluginEntry[]) =>
    new PluginManager({
      plugins,
      stateClient,
      createContext: (plugin) => createPluginContext(plugin, services),
      refreshParsing,
      reportActivationError,
      log: vi.fn()
    })
  return {
    createManager,
    push: async(state: PluginHostState) => {
      pushState!(state)
      await flush()
    },
    muya,
    registries,
    unregister,
    subcommands,
    keyTarget,
    keybindings,
    keybindingLog,
    eventListeners,
    tabViewDisposals,
    services,
    reportActivationError,
    refreshParsing,
    engine
  }
}

const entry = (id: string, module: RendererPluginModule, extra: Partial<PluginManifest> = {}): RendererPluginEntry => ({
  manifest: manifest(id, extra),
  locales: { en: {} },
  load: async() => module
})

/** A plugin using every registration the context offers. */
const fullPlugin = (hooks: { deactivate?: () => void } = {}) => {
  const seen: { ctx?: RendererPluginContext } = {}
  const module: RendererPluginModule = {
    activate(ctx) {
      seen.ctx = ctx
      ctx.ui.registerSidebarPanel({ id: 'calendar', title: 'panel', icon: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>', component: Panel })
      ctx.ui.registerStatusBarItem({ id: 'grammar-status', component: Panel })
      ctx.commands.register({ id: 'full.run', title: 'command.run', run: vi.fn(), keybinding: 'Ctrl+Alt+K' })
      ctx.editor.setDecorations('grammar', [{ path: [0, 'children', 0], start: 0, end: 2, className: 'x' }])
      ctx.editor.registerInlineSyntax({ name: 'wikilink', precedence: 'beforeEmphasis', match: () => null })
      ctx.editor.registerCodeBlockRenderer({ lang: ['dataview'], render: () => {} })
      ctx.editor.registerCompletionProvider({ id: 'links', trigger: /\[\[([^\]]*)$/, getItems: () => [] })
      ctx.editor.requestEngineOptions({ atxHeadingRequiresSpace: true })
      ctx.workspace.registerTabView({ id: 'kanban', kind: 'markdown', title: 'board', component: Panel })
      ctx.ipc.on('progress', () => {})
    },
    deactivate: hooks.deactivate
  }
  return { module, seen }
}

const pressCtrlAltK = (target: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('renderer PluginManager', () => {
  let harness: ReturnType<typeof createHarness>
  let manager: PluginManager | null = null

  beforeEach(() => {
    manager = null
  })

  afterEach(async() => {
    await manager?.stop()
  })

  it('activates enabled plugins and exposes every registration', async() => {
    harness = createHarness(stateWith({ full: true }))
    const { module, seen } = fullPlugin()
    manager = harness.createManager([entry('full', module)])
    await manager.start()

    expect(manager.isActive('full')).toBe(true)
    expect(listSidebarPanels().map((p) => [p.id, p.ctx.t(p.title)])).toEqual([['calendar', 'full:panel']])
    expect(listStatusBarItems().map((i) => i.id)).toEqual(['grammar-status'])
    expect(harness.subcommands.map((c) => [c.id, c.description])).toEqual([['full.run', 'full:command.run']])
    expect(pressCtrlAltK(harness.keyTarget).defaultPrevented).toBe(true)
    expect(harness.muya.setDecorations).toHaveBeenCalledWith('full/grammar', expect.any(Array))
    expect(harness.registries.registerInlineSyntax).toHaveBeenCalledTimes(1)
    expect(harness.engine.getEngineOptions()).toEqual({ atxHeadingRequiresSpace: true })
    expect(harness.muya.setOptions).toHaveBeenLastCalledWith({
      atxHeadingRequiresSpace: true,
      mermaidThemeOverride: null,
      mermaidLook: 'classic'
    })
    expect(harness.services.registerTabView).toHaveBeenCalledWith(seen.ctx, expect.objectContaining({ id: 'kanban' }))
    expect(harness.eventListeners.size).toBe(1)
    await flush()
    expect(harness.muya.refreshInlineRendering).toHaveBeenCalledTimes(1)
  })

  it('disposes every registration on disable, even when deactivate throws', async() => {
    harness = createHarness(stateWith({ full: true }))
    const deactivate = vi.fn(() => {
      throw new Error('deactivate failed')
    })
    manager = harness.createManager([entry('full', fullPlugin({ deactivate }).module)])
    await manager.start()

    await harness.push(stateWith({ full: false }))

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(manager.isActive('full')).toBe(false)
    expect(listSidebarPanels()).toHaveLength(0)
    expect(harness.services.onSidebarPanelRemoved).toHaveBeenCalledWith('calendar')
    expect(listStatusBarItems()).toHaveLength(0)
    expect(harness.subcommands).toHaveLength(0)
    expect(pressCtrlAltK(harness.keyTarget).defaultPrevented).toBe(false)
    expect(harness.muya.clearDecorations).toHaveBeenCalledWith('full/grammar')
    expect(harness.unregister.inline).toHaveBeenCalledTimes(1)
    expect(harness.unregister.codeBlock).toHaveBeenCalledTimes(1)
    expect(harness.unregister.completion).toHaveBeenCalledTimes(1)
    expect(harness.engine.getEngineOptions()).toEqual({ atxHeadingRequiresSpace: false })
    expect(harness.muya.setOptions).toHaveBeenLastCalledWith({
      atxHeadingRequiresSpace: false,
      mermaidThemeOverride: null,
      mermaidLook: 'classic'
    })
    expect(harness.tabViewDisposals).toHaveBeenCalledTimes(1)
    expect(harness.eventListeners.size).toBe(0)
  })

  it('isolates a plugin that fails to activate and undoes what it registered', async() => {
    harness = createHarness(stateWith({ broken: true, healthy: true }))
    const failure = new Error('cannot start')
    const broken = entry('broken', {
      activate(ctx) {
        ctx.ui.registerStatusBarItem({ id: 'broken-item', component: Panel })
        throw failure
      }
    })
    const healthy = entry('healthy', {
      activate(ctx) {
        ctx.ui.registerStatusBarItem({ id: 'healthy-item', component: Panel })
      }
    })
    manager = harness.createManager([broken, healthy])
    await manager.start()

    expect(manager.isActive('broken')).toBe(false)
    expect(manager.isActive('healthy')).toBe(true)
    expect(harness.reportActivationError).toHaveBeenCalledWith(broken, failure)
    expect(listStatusBarItems().map((i) => i.id)).toEqual(['healthy-item'])
  })

  it('activates nothing in safe mode', async() => {
    harness = createHarness(stateWith({ full: true }, { safeMode: true }))
    const activate = vi.fn()
    manager = harness.createManager([entry('full', { activate })])
    await manager.start()
    expect(activate).not.toHaveBeenCalled()
    await harness.push(stateWith({ full: true }, { safeMode: true }))
    expect(activate).not.toHaveBeenCalled()
  })

  it('activates a plugin when it gets enabled and refreshes parsing for affectsParsing plugins', async() => {
    harness = createHarness(stateWith({ tags: false }))
    const activate = vi.fn()
    manager = harness.createManager([entry('tags', { activate }, { affectsParsing: true })])
    await manager.start()
    expect(harness.refreshParsing).not.toHaveBeenCalled()

    await harness.push(stateWith({ tags: true }))
    expect(activate).toHaveBeenCalledTimes(1)
    expect(harness.refreshParsing).toHaveBeenCalledTimes(1)

    await harness.push(stateWith({ tags: false }))
    expect(harness.refreshParsing).toHaveBeenCalledTimes(2)
  })

  it('reports setting changes of the plugin with schema defaults', async() => {
    harness = createHarness(stateWith({ grammar: true }))
    const changes: unknown[] = []
    let ctx: RendererPluginContext | null = null
    const plugin = entry(
      'grammar',
      {
        activate(c) {
          ctx = c
          c.settings.onDidChange((key, value) => changes.push([key, value]))
        }
      },
      { settings: [{ key: 'level', label: 'l', type: 'enum', default: 'default', options: [{ value: 'default', label: 'd' }, { value: 'picky', label: 'p' }] }] }
    )
    manager = harness.createManager([plugin])
    await manager.start()
    expect(ctx!.settings.get('level')).toBe('default')
    await harness.push(stateWith({ grammar: true }, { settings: { grammar: { level: 'picky' } } }))
    expect(changes).toEqual([['level', 'picky']])
    expect(ctx!.settings.get('level')).toBe('picky')
  })

  it('unwraps plugin IPC results', async() => {
    harness = createHarness(stateWith({ full: true }))
    let ctx: RendererPluginContext | null = null
    manager = harness.createManager([entry('full', { activate: (c) => { ctx = c } })])
    await manager.start()
    await expect(ctx!.ipc.invoke('ping', 1)).resolves.toBe('pong')
    expect(harness.services.bridge.invoke).toHaveBeenCalledWith('full', 'ping', [1])
    vi.mocked(harness.services.bridge.invoke).mockResolvedValueOnce({ ok: false, error: { code: 'DISABLED', message: 'off' } })
    await expect(ctx!.ipc.invoke('ping')).rejects.toMatchObject({ code: 'DISABLED', message: 'off' })
  })
})

describe('plugin keybindings', () => {
  it('ignores a keybinding that collides with an app accelerator and logs it', () => {
    const target = new EventTarget()
    const log = vi.fn()
    const keybindings = new PluginKeybindings(target, false, log)
    const run = vi.fn()
    keybindings.register('plugin.cmd', 'CmdOrCtrl+Alt+K', run)
    keybindings.setAppKeybindings({ 'edit.something': 'Ctrl+Alt+K' })
    expect(pressCtrlAltK(target).defaultPrevented).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('collides with an app shortcut'))
    keybindings.setAppKeybindings({})
    pressCtrlAltK(target)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps the first of two plugin bindings on the same keys', () => {
    const target = new EventTarget()
    const keybindings = new PluginKeybindings(target, false, vi.fn())
    const first = vi.fn()
    const second = vi.fn()
    keybindings.register('a', 'Ctrl+Alt+K', first)
    const secondBinding = keybindings.register('b', 'Ctrl+Alt+K', second)
    pressCtrlAltK(target)
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 0])
    expect(keybindings.isActive('b')).toBe(false)
    secondBinding?.dispose()
  })

  it('matches letters by physical key so Alt-modified characters still trigger', () => {
    const target = new EventTarget()
    const keybindings = new PluginKeybindings(target, true, vi.fn())
    const run = vi.fn()
    keybindings.register('a', 'CmdOrCtrl+Alt+D', run)
    target.dispatchEvent(new KeyboardEvent('keydown', { key: '∂', code: 'KeyD', metaKey: true, altKey: true }))
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, altKey: true }))
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('engine host', () => {
  it('reports host edits as api and others as user', async() => {
    const muya = createFakeMuya()
    const engine = new EngineHost({ getActiveTabId: () => 't', isMac: false, registries: {} as EngineRegistries })
    engine.attach(muya as unknown as EngineInstance)
    const events: unknown[] = []
    engine.onDidChangeContent((e) => events.push(e))
    engine.notifyContentChange('t')
    engine.asApi(() => engine.notifyContentChange('t'))
    engine.notifyContentChange('other-tab')
    await flush()
    expect(events).toEqual([{ tabId: 't', source: 'user' }, { tabId: 't', source: 'api' }])
  })

  it('routes ctrl-clicks on custom tokens and ignores plain clicks', () => {
    const muya = createFakeMuya()
    const engine = new EngineHost({ getActiveTabId: () => 't', isMac: false, registries: {} as EngineRegistries })
    engine.attach(muya as unknown as EngineInstance)
    const clicks: unknown[] = []
    const registration = engine.onDidClickInlineToken('wikilink', ({ data }) => clicks.push(data))
    muya.emit('format-click', { event: new MouseEvent('click', { ctrlKey: true }), formatType: 'wikilink', data: { target: 'Note' } })
    muya.emit('format-click', { event: new MouseEvent('click'), formatType: 'wikilink', data: { target: 'Other' } })
    muya.emit('format-click', { event: new MouseEvent('click', { ctrlKey: true }), formatType: 'link', data: {} })
    registration.dispose()
    muya.emit('format-click', { event: new MouseEvent('click', { ctrlKey: true }), formatType: 'wikilink', data: { target: 'Late' } })
    expect(clicks).toEqual([{ target: 'Note' }])
  })

  it('re-applies the OR of option requests to a newly attached engine', () => {
    const engine = new EngineHost({ getActiveTabId: () => 't', isMac: false, registries: {} as EngineRegistries })
    const a = engine.requestEngineOptions({ atxHeadingRequiresSpace: true })
    engine.requestEngineOptions({ atxHeadingRequiresSpace: false })
    const muya = createFakeMuya()
    engine.attach(muya as unknown as EngineInstance)
    expect(muya.setOptions).toHaveBeenLastCalledWith({
      atxHeadingRequiresSpace: true,
      mermaidThemeOverride: null,
      mermaidLook: 'classic'
    })
    a.dispose()
    expect(muya.setOptions).toHaveBeenLastCalledWith({
      atxHeadingRequiresSpace: false,
      mermaidThemeOverride: null,
      mermaidLook: 'classic'
    })
  })
})

describe('sidebar icon sanitizing', () => {
  it('keeps a plain svg and strips scripts, handlers and external references', () => {
    const clean = sanitizeSvgIcon(
      '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script><path d="M0 0" fill="currentColor"/><use href="https://x/y.svg#a"/></svg>'
    )
    expect(clean).toContain('<path')
    expect(clean).not.toMatch(/onload|script|<use|https:/)
  })

  it('rejects markup that is not a single svg', () => {
    expect(sanitizeSvgIcon('<img src=x onerror=alert(1)>')).toBe('')
    expect(sanitizeSvgIcon('<svg></svg><svg></svg>')).toBe('')
  })
})
