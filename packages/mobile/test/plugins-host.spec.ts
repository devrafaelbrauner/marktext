import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PluginHostState } from '@shared/plugins/types'
import { MemoryFileBackend } from '../src/main/fs/memoryBackend'
import { connectWindow, EDITOR_WINDOW_ID, SETTINGS_WINDOW_ID } from '../src/main/ipc'
import { createMobilePluginHost, PLUGINS_STATE_PATH, registerPluginIpc, type MobilePluginHost } from '../src/main/plugins'
import { CachedPluginSecrets, memorySecretsBackend, type SecretsBackend } from '../src/main/plugins/secrets'
import { getActiveFile, setRootPath } from '../src/main/state'

vi.stubGlobal('MARKTEXT_VERSION', '0.21.0')

const SECRET = 'sk-or-v1-0123456789abcdef'
const editor = connectWindow(EDITOR_WINDOW_ID)
const settingsWindow = connectWindow(SETTINGS_WINDOW_ID)
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let backend: MemoryFileBackend
let secretsBackend: SecretsBackend
let plugins: MobilePluginHost
const pushed: PluginHostState[] = []

beforeAll(async() => {
  backend = new MemoryFileBackend({ '/vault/k/note.md': '# Note' })
  secretsBackend = memorySecretsBackend()
  plugins = await createMobilePluginHost(backend, await CachedPluginSecrets.load(secretsBackend), async() => {
    throw new Error('no network in tests')
  })
  registerPluginIpc(plugins, backend)
  editor.on('mt::plugins::state-changed', (_event, state) => pushed.push(state as PluginHostState))
})

describe('plugin host on Android', () => {
  it('serves the built-in state with manifest defaults', async() => {
    const state = (await editor.invoke('mt::plugins::get-state')) as PluginHostState
    expect(state.safeMode).toBe(false)
    expect(state.enabled).toMatchObject({ links: true, tags: true, grammar: false, ai: false })
    expect(state.secretsSet.grammar).toEqual({ apiKey: false })
  })

  it('persists toggles and settings to plugins.json and reloads them', async() => {
    expect(await editor.invoke('mt::plugins::set-enabled', 'links', false)).toEqual({ ok: true, value: null })
    expect(await editor.invoke('mt::plugins::set-setting', 'grammar', 'language', 'pt-BR')).toEqual({ ok: true, value: null })
    await plugins.settled()
    await flush()
    expect(pushed.at(-1)?.enabled.links).toBe(false)

    const saved = JSON.parse(await backend.readText(PLUGINS_STATE_PATH))
    expect(saved).toEqual({ enabled: { links: false }, settings: { grammar: { language: 'pt-BR' } } })

    const reloaded = await createMobilePluginHost(backend, await CachedPluginSecrets.load(memorySecretsBackend()))
    const state = reloaded.host.getState()
    expect(state.enabled.links).toBe(false)
    expect(state.settings.grammar).toEqual({ language: 'pt-BR' })

    await editor.invoke('mt::plugins::set-enabled', 'links', true)
  })

  it('rejects invalid settings and unknown plugins as typed results', async() => {
    expect(await editor.invoke('mt::plugins::set-setting', 'grammar', 'apiKey', 'x')).toMatchObject({ ok: false, error: { code: 'FAILED' } })
    expect(await editor.invoke('mt::plugins::set-enabled', 'nope', true)).toMatchObject({ ok: false, error: { code: 'FAILED' } })
    expect(await editor.invoke('mt::plugins::invoke', 'grammar', 'check', [])).toMatchObject({ ok: false, error: { code: 'DISABLED' } })
  })

  it('stores a secret without ever exposing its value', async() => {
    expect(await settingsWindow.invoke('mt::plugins::set-secret', 'grammar', 'apiKey', SECRET)).toEqual({ ok: true, value: null })
    await plugins.settled()
    await flush()

    const state = (await editor.invoke('mt::plugins::get-state')) as PluginHostState
    expect(state.secretsSet.grammar).toEqual({ apiKey: true })
    expect(JSON.stringify(state)).not.toContain(SECRET)
    expect(JSON.stringify(pushed)).not.toContain(SECRET)
    expect(await backend.readText(PLUGINS_STATE_PATH)).not.toContain(SECRET)
    expect(await secretsBackend.get('grammar', 'apiKey')).toBe(SECRET)
    expect(await secretsBackend.list()).toEqual({ grammar: ['apiKey'] })

    expect(await editor.invoke('mt::plugins::set-secret', 'grammar', 'apiKey', null)).toEqual({ ok: true, value: null })
    expect(((await editor.invoke('mt::plugins::get-state')) as PluginHostState).secretsSet.grammar).toEqual({ apiKey: false })
    expect(await secretsBackend.get('grammar', 'apiKey')).toBeNull()
    expect(await editor.invoke('mt::plugins::set-secret', 'grammar', 'language', 'x')).toMatchObject({ ok: false })
  })

  it('scopes vault calls to the active file folder, then to the open folder', async() => {
    setRootPath(null)
    expect(await editor.invoke('mt::vault::exists', '/vault/k/note.md')).toMatchObject({ ok: false, error: { code: 'OUTSIDE_VAULT' } })

    editor.send('mt::vault::set-active-file', '/vault/k/note.md')
    settingsWindow.send('mt::vault::set-active-file', null)
    await flush()
    expect(getActiveFile()).toBe('/vault/k/note.md')
    const read = (await editor.invoke('mt::vault::read-text', '/vault/k/note.md')) as { ok: true; value: { content: string; mtimeMs: number } }
    expect(read.value.content).toBe('# Note')
    expect(await editor.invoke('mt::vault::write-text', '/vault/k/note.md', 'x', read.value.mtimeMs - 1)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })

    setRootPath('/vault/k')
    editor.send('mt::vault::set-active-file', null)
    await flush()
    expect(await editor.invoke('mt::vault::list', ['md'])).toMatchObject({ ok: true, value: [{ path: '/vault/k/note.md' }] })
    setRootPath(null)
  })

  it('reports a cancelled community install and denies fetch for unknown plugins', async() => {
    expect(await editor.invoke('mt::community::install', 'folder')).toEqual({ ok: false, error: { code: 'FAILED', message: 'CANCELED' } })
    expect(await editor.invoke('mt::community::install', 'exe')).toMatchObject({ ok: false })
    expect(await editor.invoke('mt::community::fetch', 'word-counter', 'https://example.com/')).toMatchObject({
      ok: false,
      error: { code: 'DISABLED' }
    })
  })

  it('installs a community plugin from the folder picker, disabled until consent', async() => {
    const fixture = path.resolve(__dirname, '../../desktop/test/fixtures/community-plugins/word-counter')
    for (const name of readdirSync(fixture)) {
      backend.put(`/vault/docs/word-counter/${name}`, new Uint8Array(readFileSync(path.join(fixture, name))))
    }
    backend.pickQueue.push({ path: '/vault/docs/word-counter', name: 'word-counter' })
    expect(await editor.invoke('mt::community::install', 'folder')).toEqual({ ok: true, value: { id: 'word-counter', name: 'Word counter' } })
    let state = (await editor.invoke('mt::plugins::get-state')) as PluginHostState
    expect(state.enabled['word-counter']).toBe(false)
    expect(state.community?.map((record) => record.id)).toEqual(['word-counter'])

    expect(await editor.invoke('mt::community::set-enabled', 'word-counter', true)).toEqual({ ok: true, value: null })
    await plugins.settled()
    state = (await editor.invoke('mt::plugins::get-state')) as PluginHostState
    expect(state.community?.[0].grantedPermissions).toEqual(['editor:read', 'ui:sidebar'])
    expect(await backend.stat('/data/marktext/plugin-host/word-counter/bootstrap.js')).not.toBeNull()
    // No network:<host> permission was declared, so the grant does not cover it.
    expect(await editor.invoke('mt::community::fetch', 'word-counter', 'https://example.com/')).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' }
    })

    expect(await editor.invoke('mt::community::uninstall', 'word-counter')).toEqual({ ok: true, value: null })
    await plugins.settled()
    expect(await backend.stat('/data/marktext/plugin-host/word-counter')).toBeNull()
  })
})
