/**
 * Client for a community plugin. The host loads `main` inside a sandboxed
 * iframe and calls the object `definePlugin` stored on
 * `globalThis.__MT_PLUGIN_DEFINITION__`. Protocol 1 matches
 * `packages/desktop/src/shared/plugins/community.ts`.
 */

export const COMMUNITY_PROTOCOL = 1

export interface Disposable {
  dispose(): void
}

export interface NotifyOptions {
  title?: string
  message: string
  type?: 'primary' | 'info' | 'warning' | 'error'
  timeout?: number
}

export interface CommandRegistration {
  id: string
  title: string
  keybinding?: string
  run(): void | Promise<void>
}

export interface CodeBlockRenderContext {
  source: string
  lang: string
}

export interface CodeBlockRenderer {
  lang: string[]
  debounceMs?: number
  render(ctx: CodeBlockRenderContext): string | Promise<string>
  exportHtml?(source: string, lang: string): string | Promise<string>
}

export interface DecorationRange {
  path: Array<string | number>
  start: number
  end: number
  className: 'spelling' | 'grammar' | 'style' | 'info' | string
  data?: Record<string, string>
}

export interface PluginApi {
  readonly manifest: unknown
  readonly language: string
  readonly settings: {
    get(key: string): unknown
    set(key: string, value: unknown): Promise<void>
    onDidChange(listener: (key: string, value: unknown) => void): Promise<Disposable>
  }
  commands: {
    register(command: CommandRegistration): Promise<Disposable>
  }
  notify(options: NotifyOptions): Promise<void>
  openSettings(): Promise<void>
  editor: {
    getMarkdown(): Promise<string | null>
    getActiveTab(): Promise<unknown>
    getCheckableBlocks(paths?: unknown): Promise<unknown>
    onDidChangeContent(listener: (event: unknown) => void): Promise<Disposable>
    onDidChangeActiveTab(listener: (tab: unknown) => void): Promise<Disposable>
    onDidSetContent(listener: (event: unknown) => void): Promise<Disposable>
    insertText(text: string): Promise<void>
    replaceRange(edit: unknown): Promise<boolean>
    setDecorations(layerId: string, ranges: DecorationRange[]): Promise<void>
    clearDecorations(layerId: string): Promise<void>
    onDidClickDecoration(layerId: string, listener: (event: unknown) => void): Promise<Disposable>
    registerCodeBlockRenderer(renderer: CodeBlockRenderer): Promise<Disposable>
  }
  vault: {
    readText(path: string): Promise<unknown>
    readBinary(path: string, maxBytes?: number): Promise<{ base64: string }>
    exists(path: string): Promise<boolean>
    list(options?: { extensions?: string[] }): Promise<unknown>
    writeText(path: string, content: string, options?: { expectedMtimeMs?: number }): Promise<unknown>
    createText(path: string, content: string): Promise<void>
  }
  metadata: {
    isReady(): Promise<boolean>
    getFile(path: string): Promise<unknown>
    listFiles(): Promise<unknown>
    resolveLink(target: string, sourcePath: string): Promise<string | null>
    getBacklinks(path: string): Promise<unknown>
    getTags(): Promise<unknown>
    getFilesWithTag(tag: string, options?: { includeNested?: boolean }): Promise<unknown>
    subscribe(listener: (event: { event: string; payload: unknown }) => void): Promise<Disposable>
  }
  net: {
    fetch(url: string, init?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<unknown>
  }
  ui: {
    registerSidebarPanel(panel: { id: string; title: string; icon: string; entry: string; order?: number }): Promise<Disposable>
    revealSidebarPanel(id: string): Promise<void>
    registerStatusBarItem(item: { id: string; text: string; tooltip?: string; order?: number }): Promise<Disposable>
    updateStatusBarItem(id: string, patch: { text?: string; tooltip?: string }): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
  }
  onDidChangeLanguage(listener: (language: string) => void): Disposable
}

export interface PluginDefinition {
  activate(api: PluginApi): void | Promise<void>
  deactivate?(): void | Promise<void>
}

interface InitMessage {
  type: 'mt-plugin:init'
  protocol: number
  manifest: unknown
  language: string
  settings: Record<string, unknown>
}

interface PendingPlugin {
  kind: 'background'
  start(init: InitMessage, port: MessagePort): Promise<void>
}

interface RpcError extends Error {
  code: string
}

const rpcError = (code: string, message: string): RpcError => Object.assign(new Error(message), { code })

class PortClient {
  private seq = 1
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>()
  private readonly reverse = new Map<string, (args: unknown[]) => Promise<unknown>>()

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', (event) => {
      this.onMessage(event.data).catch(() => {})
    })
    port.start()
  }

  call<T>(method: string, payload?: unknown): Promise<T> {
    const id = this.seq++
    let resolveCall: (value: unknown) => void = () => {}
    let rejectCall: (error: Error) => void = () => {}
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveCall = resolve
      rejectCall = reject
    })
    this.pending.set(id, { resolve: resolveCall, reject: rejectCall })
    this.port.postMessage({ id, method, args: payload === undefined ? [] : [payload] })
    return promise as Promise<T>
  }

  on(event: string, listener: (payload: unknown) => void): Disposable {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return { dispose: () => set.delete(listener) }
  }

  handle(method: string, fn: (args: unknown[]) => Promise<unknown>): void {
    this.reverse.set(method, fn)
  }

  private async onMessage(data: unknown): Promise<void> {
    if (!data || typeof data !== 'object') return
    if ('ok' in data && 'id' in data && typeof data.id === 'number') {
      const pending = this.pending.get(data.id)
      this.pending.delete(data.id)
      if (!pending) return
      if (data.ok === true) pending.resolve('value' in data ? data.value : undefined)
      else {
        const error = 'error' in data && data.error && typeof data.error === 'object' ? data.error : null
        const code = error && 'code' in error && typeof error.code === 'string' ? error.code : 'FAILED'
        const message = error && 'message' in error && typeof error.message === 'string' ? error.message : 'RPC failed'
        pending.reject(rpcError(code, message))
      }
      return
    }
    if ('method' in data && 'id' in data && typeof data.method === 'string' && typeof data.id === 'string') {
      const args = 'args' in data && Array.isArray(data.args) ? data.args : []
      const fn = this.reverse.get(data.method)
      try {
        const value = fn ? await fn(args) : undefined
        this.port.postMessage({ id: data.id, ok: true, value })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.port.postMessage({ id: data.id, ok: false, error: { code: 'FAILED', message } })
      }
      return
    }
    if ('event' in data && typeof data.event === 'string') {
      const payload = 'payload' in data ? data.payload : undefined
      for (const listener of this.listeners.get(data.event) ?? []) listener(payload)
    }
  }
}

const subscribe = async(
  client: PortClient,
  method: string,
  event: string,
  listener: (payload: unknown) => void
): Promise<Disposable> => {
  const result = await client.call<{ handle: string }>(method, {})
  const off = client.on(event, listener)
  return {
    dispose() {
      off.dispose()
      client.call('dispose', { handle: result.handle }).catch(() => {})
    }
  }
}

const createApi = (client: PortClient, init: InitMessage): PluginApi => {
  let language = init.language
  const commands = new Map<string, () => void | Promise<void>>()
  const renderers = new Map<string, CodeBlockRenderer>()
  client.handle('command.run', async(args) => {
    const payload = args[0]
    const id = payload && typeof payload === 'object' && 'id' in payload && typeof payload.id === 'string' ? payload.id : ''
    const run = commands.get(id)
    if (!run) throw new Error(`Unknown command ${id}`)
    await run()
  })
  client.handle('codeblock.render', async(args) => {
    const payload = args[0]
    if (!payload || typeof payload !== 'object' || !('token' in payload)) return ''
    const renderer = typeof payload.token === 'string' ? renderers.get(payload.token) : undefined
    if (!renderer) return ''
    const source = 'source' in payload && typeof payload.source === 'string' ? payload.source : ''
    const lang = 'lang' in payload && typeof payload.lang === 'string' ? payload.lang : ''
    return renderer.render({ source, lang })
  })
  client.handle('codeblock.exportHtml', async(args) => {
    const payload = args[0]
    if (!payload || typeof payload !== 'object' || !('token' in payload) || typeof payload.token !== 'string') return ''
    const renderer = renderers.get(payload.token)
    if (!renderer?.exportHtml) return ''
    const source = 'source' in payload && typeof payload.source === 'string' ? payload.source : ''
    const lang = 'lang' in payload && typeof payload.lang === 'string' ? payload.lang : ''
    return renderer.exportHtml(source, lang)
  })
  client.on('host:language', (payload) => {
    if (payload && typeof payload === 'object' && 'language' in payload && typeof payload.language === 'string') {
      language = payload.language
    }
  })
  return {
    manifest: init.manifest,
    get language() {
      return language
    },
    settings: {
      get: (key) => client.call('settings.get', { key }),
      set: (key, value) => client.call('settings.set', { key, value }),
      onDidChange: (listener) => subscribe(client, 'settings.subscribe', 'settings:change', (payload) => {
        if (payload && typeof payload === 'object' && 'key' in payload) {
          listener(String(payload.key), 'value' in payload ? payload.value : undefined)
        }
      })
    },
    commands: {
      register: async(command) => {
        commands.set(command.id, command.run)
        const result = await client.call<{ handle: string }>('commands.register', {
          id: command.id,
          title: command.title,
          keybinding: command.keybinding
        })
        return {
          dispose() {
            commands.delete(command.id)
            client.call('dispose', { handle: result.handle }).catch(() => {})
          }
        }
      }
    },
    notify: (options) => client.call('notify', options),
    openSettings: () => client.call('ui.openSettings'),
    editor: {
      getMarkdown: () => client.call('editor.getMarkdown'),
      getActiveTab: () => client.call('editor.getActiveTab'),
      getCheckableBlocks: (paths) => client.call('editor.getCheckableBlocks', paths === undefined ? {} : { paths }),
      onDidChangeContent: (listener) => subscribe(client, 'editor.subscribeContent', 'editor:content-change', listener),
      onDidChangeActiveTab: (listener) => subscribe(client, 'editor.subscribeActiveTab', 'editor:active-tab', listener),
      onDidSetContent: (listener) => subscribe(client, 'editor.subscribeSetContent', 'editor:set-content', listener),
      insertText: (text) => client.call('editor.insertText', { text }),
      replaceRange: (edit) => client.call('editor.replaceRange', edit),
      setDecorations: (layerId, ranges) => client.call('editor.setDecorations', { layerId, ranges }),
      clearDecorations: (layerId) => client.call('editor.clearDecorations', { layerId }),
      onDidClickDecoration: (layerId, listener) => subscribe(client, 'editor.subscribeDecorationClick', 'editor:decoration-click', (payload) => {
        if (payload && typeof payload === 'object' && 'layerId' in payload && payload.layerId === layerId) listener(payload)
      }),
      registerCodeBlockRenderer: async(renderer) => {
        const result = await client.call<{ handle: string }>('editor.registerCodeBlockRenderer', {
          lang: renderer.lang,
          debounceMs: renderer.debounceMs
        })
        renderers.set(result.handle, renderer)
        return {
          dispose() {
            renderers.delete(result.handle)
            client.call('dispose', { handle: result.handle }).catch(() => {})
          }
        }
      }
    },
    vault: {
      readText: (path) => client.call('vault.readText', { path }),
      readBinary: (path, maxBytes) => client.call('vault.readBinary', { path, maxBytes }),
      exists: (path) => client.call('vault.exists', { path }),
      list: (options) => client.call('vault.list', options ?? {}),
      writeText: (path, content, options) => client.call('vault.writeText', { path, content, ...options }),
      createText: (path, content) => client.call('vault.createText', { path, content })
    },
    metadata: {
      isReady: () => client.call('metadata.isReady'),
      getFile: (path) => client.call('metadata.getFile', { path }),
      listFiles: () => client.call('metadata.listFiles'),
      resolveLink: (target, sourcePath) => client.call('metadata.resolveLink', { target, sourcePath }),
      getBacklinks: (path) => client.call('metadata.getBacklinks', { path }),
      getTags: () => client.call('metadata.getTags'),
      getFilesWithTag: (tag, options) => client.call('metadata.getFilesWithTag', { tag, ...options }),
      subscribe: (listener) => subscribe(client, 'metadata.subscribe', 'metadata:change', (payload) => {
        listener({ event: 'change', payload })
      })
    },
    net: {
      fetch: (url, init) => client.call('net.fetch', { url, ...init })
    },
    ui: {
      registerSidebarPanel: (panel) => client.call('ui.registerSidebarPanel', panel).then((result) => ({
        dispose() {
          const handle = result && typeof result === 'object' && 'handle' in result ? String(result.handle) : ''
          client.call('dispose', { handle }).catch(() => {})
        }
      })),
      revealSidebarPanel: (id) => client.call('ui.revealSidebarPanel', { id }),
      registerStatusBarItem: (item) => client.call('ui.registerStatusBarItem', item).then((result) => ({
        dispose() {
          const handle = result && typeof result === 'object' && 'handle' in result ? String(result.handle) : ''
          client.call('dispose', { handle }).catch(() => {})
        }
      })),
      updateStatusBarItem: (id, patch) => client.call('ui.updateStatusBarItem', { id, ...patch })
    },
    clipboard: {
      writeText: (text) => client.call('clipboard.writeText', { text })
    },
    onDidChangeLanguage(listener) {
      return client.on('host:language', (payload) => {
        if (payload && typeof payload === 'object' && 'language' in payload && typeof payload.language === 'string') {
          listener(payload.language)
        }
      })
    }
  }
}

const crashToParent = (message: string): void => {
  window.parent.postMessage({ type: 'mt-plugin:crash', message }, '*')
}

/** Registers the background plugin. Call it from `main` at import time. */
export const definePlugin = (definition: PluginDefinition): void => {
  const slot = globalThis as typeof globalThis & { __MT_PLUGIN_DEFINITION__?: PendingPlugin }
  slot.__MT_PLUGIN_DEFINITION__ = {
    kind: 'background',
    async start(init, port) {
      const client = new PortClient(port)
      const api = createApi(client, init)
      window.addEventListener('error', (event) => {
        port.postMessage({ event: 'crash', payload: { message: event.message } })
      })
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason
        const message = reason instanceof Error ? reason.message : String(reason)
        port.postMessage({ event: 'crash', payload: { message } })
      })
      client.on('host:shutdown', () => {
        definition.deactivate?.()?.catch(() => {})
      })
      try {
        await definition.activate(api)
        port.postMessage({ event: 'activated', payload: {} })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        port.postMessage({ event: 'crash', payload: { message } })
        crashToParent(message)
        throw err
      }
    }
  }
}
export const definePanel = (setup: (api: PluginApi, root: HTMLElement) => void | Promise<void>): void => {
  const root = document.getElementById('root') ?? document.body
  let resolveInit: (value: { data: InitMessage; port: MessagePort }) => void = () => {}
  const ready = new Promise<{ data: InitMessage; port: MessagePort }>((resolve) => {
    resolveInit = resolve
  })
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const data = event.data
    if (!data || data.type !== 'mt-plugin:init' || data.protocol !== COMMUNITY_PROTOCOL) return
    const port = event.ports?.[0]
    if (!port) return
    resolveInit({ data, port })
  })
  window.parent.postMessage({ type: 'mt-plugin:hello', role: 'panel' }, '*')
  ready.then(async({ data, port }) => {
    const client = new PortClient(port)
    const api = createApi(client, data)
    try {
      await setup(api, root)
      port.postMessage({ event: 'activated', payload: {} })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      port.postMessage({ event: 'crash', payload: { message } })
    }
  }).catch(() => {})
}
