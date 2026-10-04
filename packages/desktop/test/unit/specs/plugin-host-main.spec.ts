import { describe, it, expect, vi } from 'vitest'
import type { PluginHostState, PluginManifest, PluginSettingSchema } from '@shared/plugins/types'
import { MainPluginHost, type PluginSecrets } from '../../../src/main/plugins/host'
import { PluginStateStore, type PersistedPluginState } from '../../../src/main/plugins/stateStore'
import { validateSettingValue } from '../../../src/main/plugins/settings'
import { PluginError } from '../../../src/main/plugins/errors'
import type { BuiltinMainPlugin } from '../../../src/main/plugins/builtin'
import type { MainPluginContext, MainPluginModule } from '../../../src/main/plugins/types'

const SETTINGS: PluginSettingSchema[] = [
  { key: 'level', label: 'l', type: 'enum', default: 'default', options: [{ value: 'default', label: 'd' }, { value: 'picky', label: 'p' }] },
  { key: 'server', label: 's', type: 'string', default: '', pattern: '^https?://' },
  { key: 'name', label: 'n', type: 'string', default: 'x', required: true },
  { key: 'delay', label: 'd', type: 'number', default: 500, min: 100, max: 5000 },
  { key: 'enabledRules', label: 'r', type: 'stringList', default: [] },
  { key: 'picky', label: 'p', type: 'boolean', default: false },
  { key: 'apiKey', label: 'k', type: 'secret' }
]

const manifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({
  id,
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  ...extra
})

const memorySecrets = (): PluginSecrets & { values: Map<string, string> } => {
  const values = new Map<string, string>()
  return {
    values,
    has: (ns, key) => values.has(`${ns}/${key}`),
    get: async(ns, key) => values.get(`${ns}/${key}`) ?? null,
    set: async(ns, key, value) => {
      values.set(`${ns}/${key}`, value)
    },
    delete: async(ns, key) => {
      values.delete(`${ns}/${key}`)
    }
  }
}

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })

interface Setup {
  manifests: PluginManifest[]
  plugins?: BuiltinMainPlugin[]
  stored?: Partial<PersistedPluginState>
  safeMode?: boolean
}

const createHost = ({ manifests, plugins = [], stored = {}, safeMode = false }: Setup) => {
  let persisted: unknown = stored
  const store = new PluginStateStore(manifests, {
    read: () => persisted,
    write: (state) => {
      persisted = JSON.parse(JSON.stringify(state))
    }
  })
  const published: PluginHostState[] = []
  const events: unknown[][] = []
  const host = new MainPluginHost({
    manifests,
    plugins,
    store,
    secrets: memorySecrets(),
    safeMode,
    fetch: vi.fn(),
    createLogger: silentLogger,
    publishState: (state) => published.push(state),
    publishEvent: (...args) => events.push(args)
  })
  return { host, published, events, persisted: () => persisted }
}

const call = { windowId: 1, webContentsId: 1 }

const rejection = async(promise: Promise<unknown>): Promise<PluginError> => {
  try {
    await promise
  } catch (err) {
    return err as PluginError
  }
  throw new Error('expected a rejection')
}

describe('plugin setting validation', () => {
  const schema = (key: string) => SETTINGS.find((s) => s.key === key)!

  it('accepts only declared enum options', () => {
    expect(validateSettingValue(schema('level'), 'picky')).toEqual({ ok: true, value: 'picky' })
    expect(validateSettingValue(schema('level'), 'loose').ok).toBe(false)
  })

  it('enforces the number range inclusively and rejects NaN', () => {
    expect(validateSettingValue(schema('delay'), 100).ok).toBe(true)
    expect(validateSettingValue(schema('delay'), 5000).ok).toBe(true)
    expect(validateSettingValue(schema('delay'), 99).ok).toBe(false)
    expect(validateSettingValue(schema('delay'), 5001).ok).toBe(false)
    expect(validateSettingValue(schema('delay'), Number.NaN).ok).toBe(false)
    expect(validateSettingValue(schema('delay'), '300').ok).toBe(false)
  })

  it('applies the pattern to non-empty strings and `required` to empty ones', () => {
    expect(validateSettingValue(schema('server'), 'https://lt.example').ok).toBe(true)
    expect(validateSettingValue(schema('server'), 'ftp://lt.example').ok).toBe(false)
    expect(validateSettingValue(schema('server'), '').ok).toBe(true)
    expect(validateSettingValue(schema('name'), '').ok).toBe(false)
  })

  it('accepts string lists only', () => {
    expect(validateSettingValue(schema('enabledRules'), ['A', 'B'])).toEqual({ ok: true, value: ['A', 'B'] })
    expect(validateSettingValue(schema('enabledRules'), ['A', 1]).ok).toBe(false)
    expect(validateSettingValue(schema('enabledRules'), 'A').ok).toBe(false)
  })

  it('never stores a secret as a setting', () => {
    expect(validateSettingValue(schema('apiKey'), 'k').ok).toBe(false)
  })
})

describe('MainPluginHost state', () => {
  const manifests = [manifest('grammar', { settings: SETTINGS }), manifest('tags', { defaultEnabled: false })]

  it('drops stored values that no longer match the schema and keeps valid ones', () => {
    const { host } = createHost({
      manifests,
      stored: { settings: { grammar: { level: 'picky', delay: 1, unknown: true } } }
    })
    expect(host.getState().settings.grammar).toEqual({ level: 'picky' })
  })

  it('falls back to defaultEnabled for plugins without a stored flag', () => {
    const { host } = createHost({ manifests, stored: { enabled: { tags: true } } })
    expect(host.getState().enabled).toEqual({ grammar: true, tags: true })
  })

  it('rejects invalid settings without persisting or publishing them', async() => {
    const { host, published } = createHost({ manifests })
    expect(() => host.setSetting('grammar', 'delay', 50)).toThrow(PluginError)
    expect(() => host.setSetting('grammar', 'missing', 1)).toThrow(/Unknown setting/)
    expect(() => host.setSetting('grammar', 'apiKey', 'x')).toThrow(/Unknown setting/)
    expect(() => host.setSetting('nope', 'delay', 500)).toThrow(/Unknown plugin/)
    expect(published).toHaveLength(0)
    host.setSetting('grammar', 'delay', 800)
    expect(published.at(-1)?.settings.grammar).toEqual({ delay: 800 })
  })

  it('stores secrets only for secret fields and reports them as set', async() => {
    const { host } = createHost({ manifests })
    await host.setSecret('grammar', 'apiKey', 'abc')
    expect(host.getState().secretsSet.grammar).toEqual({ apiKey: true })
    expect(JSON.stringify(host.getState())).not.toContain('abc')
    await host.setSecret('grammar', 'apiKey', null)
    expect(host.getState().secretsSet.grammar).toEqual({ apiKey: false })
    expect((await rejection(host.setSecret('grammar', 'server', 'x'))).message).toMatch(/Unknown secret/)
  })
})

describe('MainPluginHost lifecycle and dispatch', () => {
  const echoPlugin = (spy: { activate?: () => void; deactivate?: () => void } = {}): BuiltinMainPlugin => ({
    manifest: manifest('echo', { settings: SETTINGS }),
    load: async(): Promise<MainPluginModule> => ({
      activate(ctx: MainPluginContext) {
        spy.activate?.()
        ctx.handle('echo', (info, ...args) => ({ info, args }))
        ctx.handle('boom', () => {
          throw new Error('kaput')
        })
      },
      deactivate: spy.deactivate
    })
  })

  it('routes calls to the handler with the caller info', async() => {
    const plugin = echoPlugin()
    const { host } = createHost({ manifests: [plugin.manifest], plugins: [plugin] })
    await host.start()
    await expect(host.invoke('echo', 'echo', [1, 'a'], call)).resolves.toEqual({ info: call, args: [1, 'a'] })
  })

  it('rejects unknown methods, failing handlers and disabled plugins with their codes', async() => {
    const plugin = echoPlugin()
    const { host } = createHost({ manifests: [plugin.manifest], plugins: [plugin] })
    await host.start()
    expect((await rejection(host.invoke('echo', 'nope', [], call))).code).toBe('UNKNOWN_METHOD')
    const failed = await rejection(host.invoke('echo', 'boom', [], call))
    expect([failed.code, failed.message]).toEqual(['FAILED', 'kaput'])
    await host.setEnabled('echo', false)
    expect((await rejection(host.invoke('echo', 'echo', [], call))).code).toBe('DISABLED')
    expect(host.isActive('echo')).toBe(false)
  })

  it('waits for the initial activation instead of answering DISABLED', async() => {
    const plugin = echoPlugin()
    const { host } = createHost({ manifests: [plugin.manifest], plugins: [plugin] })
    const pending = host.invoke('echo', 'echo', [], call)
    await host.start()
    await expect(pending).resolves.toEqual({ info: call, args: [] })
  })

  it('removes handlers on disable even when deactivate throws, and re-activates on enable', async() => {
    const activate = vi.fn()
    const plugin = echoPlugin({
      activate,
      deactivate: () => {
        throw new Error('deactivate failed')
      }
    })
    const { host } = createHost({ manifests: [plugin.manifest], plugins: [plugin] })
    await host.start()
    await host.setEnabled('echo', false)
    expect(host.hasActivePlugins()).toBe(false)
    await host.setEnabled('echo', true)
    expect(activate).toHaveBeenCalledTimes(2)
    await expect(host.invoke('echo', 'echo', [], call)).resolves.toBeTruthy()
  })

  it('keeps other plugins running when one fails to activate', async() => {
    const broken: BuiltinMainPlugin = {
      manifest: manifest('broken'),
      load: async() => ({
        activate(ctx) {
          ctx.handle('x', () => 1)
          throw new Error('cannot start')
        }
      })
    }
    const plugin = echoPlugin()
    const { host } = createHost({ manifests: [broken.manifest, plugin.manifest], plugins: [broken, plugin] })
    await host.start()
    expect(host.isActive('broken')).toBe(false)
    expect(host.isActive('echo')).toBe(true)
    expect((await rejection(host.invoke('broken', 'x', [], call))).code).toBe('UNKNOWN_METHOD')
  })

  it('gives the plugin settings with defaults and change notifications', async() => {
    let ctx: MainPluginContext | null = null
    const plugin: BuiltinMainPlugin = {
      manifest: manifest('echo', { settings: SETTINGS }),
      load: async() => ({ activate: (c) => { ctx = c } })
    }
    const { host } = createHost({ manifests: [plugin.manifest], plugins: [plugin] })
    await host.start()
    const changes: unknown[] = []
    ctx!.settings.onDidChange((key, value) => changes.push([key, value]))
    expect(ctx!.settings.get('delay')).toBe(500)
    host.setSetting('echo', 'delay', 1000)
    expect(ctx!.settings.get('delay')).toBe(1000)
    expect(changes).toEqual([['delay', 1000]])
    expect(() => ctx!.settings.get('apiKey')).toThrow()
    await host.setSecret('echo', 'apiKey', 's3cret')
    expect(ctx!.secrets.isSet('apiKey')).toBe(true)
    await expect(ctx!.secrets.get('apiKey')).resolves.toBe('s3cret')
  })

  it('in safe mode activates nothing and answers DISABLED, while state stays editable', async() => {
    const activate = vi.fn()
    const plugin = echoPlugin({ activate })
    const { host } = createHost({ manifests: [plugin.manifest], plugins: [plugin], safeMode: true })
    await host.start()
    expect(activate).not.toHaveBeenCalled()
    expect(host.getState().safeMode).toBe(true)
    expect((await rejection(host.invoke('echo', 'echo', [], call))).code).toBe('DISABLED')
    await host.setEnabled('echo', true)
    expect(activate).not.toHaveBeenCalled()
    host.setSetting('echo', 'delay', 700)
    expect(host.getState().settings.echo).toEqual({ delay: 700 })
  })

  it('deactivates every plugin on stop', async() => {
    const deactivate = vi.fn()
    const plugin = echoPlugin({ deactivate })
    const { host } = createHost({ manifests: [plugin.manifest], plugins: [plugin] })
    await host.start()
    await host.stop()
    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(host.hasActivePlugins()).toBe(false)
  })

  it('only emits events while the plugin is active', async() => {
    let ctx: MainPluginContext | null = null
    const plugin: BuiltinMainPlugin = {
      manifest: manifest('echo'),
      load: async() => ({ activate: (c) => { ctx = c } })
    }
    const { host, events } = createHost({ manifests: [plugin.manifest], plugins: [plugin] })
    await host.start()
    ctx!.emit('ready', { n: 1 }, 3)
    await host.setEnabled('echo', false)
    ctx!.emit('late', null)
    expect(events).toEqual([['echo', 'ready', { n: 1 }, 3]])
  })
})
