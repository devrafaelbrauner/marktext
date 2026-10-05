import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { crc32, deflateRawSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { MemoryFileBackend } from '../src/main/fs/memoryBackend'
import { MobileCommunityRegistry } from '../src/main/plugins/community'
import type { PluginHostState } from '@shared/plugins/types'

const FIXTURE = path.resolve(__dirname, '../../desktop/test/fixtures/community-plugins/word-counter')
const fixtureFiles = (): Array<[string, Uint8Array]> =>
  readdirSync(FIXTURE).map((name) => [name, new Uint8Array(readFileSync(path.join(FIXTURE, name)))])

interface ZipInput {
  name: string
  data: Uint8Array | string
  mode?: number
  stored?: boolean
}

/** Minimal ZIP writer (deflate or stored), like the desktop installer tests. */
const zipOf = (entries: ZipInput[]): Uint8Array => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.from(entry.data)
    const compressed = entry.stored ? data : deflateRawSync(data)
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.stored ? 0 : 8, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.stored ? 0 : 8, 10)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, compressed)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]))
}

const setup = async(seed: Record<string, string> = {}) => {
  const backend = new MemoryFileBackend(seed)
  const registry = new MobileCommunityRegistry({
    backend,
    userDataPath: '/data/marktext',
    builtinIds: ['links', 'grammar'],
    appVersion: '0.21.0',
    log: () => {}
  })
  await registry.load()
  return { backend, registry }
}

const state = (enabled: Record<string, boolean>, safeMode = false): PluginHostState =>
  ({ safeMode, enabled, settings: {}, secretsSet: {} })

describe('community plugins on Android', () => {
  it('installs the word-counter fixture from a picked SAF folder into app storage', async() => {
    const { backend, registry } = await setup()
    for (const [name, data] of fixtureFiles()) backend.put(`/vault/docs/word-counter/${name}`, data)

    const record = await registry.installFolder('/vault/docs/word-counter')

    expect(record).toMatchObject({ id: 'word-counter', main: 'main.js', grantedPermissions: [] })
    expect(registry.records().map((item) => item.id)).toEqual(['word-counter'])
    for (const [name, data] of fixtureFiles()) {
      expect(await backend.readFile(`/data/marktext/plugins/word-counter/${name}`)).toEqual(data)
    }
    expect((await backend.readdir('/data/marktext/plugins')).map((entry) => entry.name)).toEqual(['word-counter'])
  })

  it('rejects a folder whose declared files are missing and keeps the installed copy', async() => {
    const { backend, registry } = await setup()
    for (const [name, data] of fixtureFiles()) backend.put(`/vault/docs/word-counter/${name}`, data)
    await registry.installFolder('/vault/docs/word-counter')
    await backend.remove('/vault/docs/word-counter/panel.html')

    await expect(registry.installFolder('/vault/docs/word-counter')).rejects.toThrow(/Declared file is missing: panel.html/)
    expect(await backend.stat('/data/marktext/plugins/word-counter/panel.html')).not.toBeNull()
    await expect(registry.installFolder('/vault/docs/nothing')).rejects.toThrow(/not found/)
  })

  it('installs from a ZIP with a top-level folder, deflated and stored entries', async() => {
    const { backend, registry } = await setup()
    const entries = fixtureFiles().map(([name, data], index) => ({ name: `word-counter-1.0.0/${name}`, data, stored: index % 2 === 0 }))
    backend.put('/doc/k1/word-counter.zip', zipOf(entries))

    const record = await registry.installZip('/doc/k1/word-counter.zip')

    expect(record.id).toBe('word-counter')
    for (const [name, data] of fixtureFiles()) {
      expect(await backend.readFile(`/data/marktext/plugins/word-counter/${name}`)).toEqual(data)
    }
  })

  it('rejects zip-slip, absolute and symlink entries without writing outside the staging folder', async() => {
    const { backend, registry } = await setup()
    const manifest = readFileSync(path.join(FIXTURE, 'manifest.json'), 'utf8')
    const cases: Array<[ZipInput[], RegExp]> = [
      [[{ name: 'manifest.json', data: manifest }, { name: '../../evil.js', data: 'owned' }], /escapes/],
      [[{ name: 'manifest.json', data: manifest }, { name: '/data/marktext/plugins.json', data: '{}' }], /escapes/],
      [[{ name: 'manifest.json', data: manifest }, { name: 'link', data: '/data/marktext', mode: 0o120777 }], /symlink/]
    ]
    for (const [entries, error] of cases) {
      backend.put('/doc/k2/bad.zip', zipOf(entries))
      await expect(registry.installZip('/doc/k2/bad.zip')).rejects.toThrow(error)
    }
    expect(await backend.stat('/data/evil.js')).toBeNull()
    expect(await backend.stat('/data/marktext/plugins.json')).toBeNull()
    expect(registry.records()).toEqual([])
  })

  it('rejects a corrupted entry by checksum', async() => {
    const { backend, registry } = await setup()
    const zip = zipOf([{ name: 'manifest.json', data: readFileSync(path.join(FIXTURE, 'manifest.json')), stored: true }])
    // Flip a byte of the stored data, after the 30-byte local header and the name.
    zip[30 + 'manifest.json'.length + 5] ^= 0xff
    backend.put('/doc/k3/broken.zip', zip)
    await expect(registry.installZip('/doc/k3/broken.zip')).rejects.toThrow(/checksum|JSON/)
  })

  it('serves only enabled plugins: host documents follow the state, with the plugin.local origin', async() => {
    const { backend, registry } = await setup()
    for (const [name, data] of fixtureFiles()) backend.put(`/vault/docs/word-counter/${name}`, data)
    await registry.installFolder('/vault/docs/word-counter')

    await registry.syncServable(state({ 'word-counter': true }))
    expect(await backend.readText('/data/marktext/plugin-host/word-counter/csp.txt')).toContain(
      "script-src 'unsafe-inline' https://word-counter.plugin.local;"
    )
    expect(await backend.readText('/data/marktext/plugin-host/word-counter/bootstrap.html')).toContain(
      'src="https://word-counter.plugin.local/__mt/bootstrap.js"'
    )
    expect(await backend.readText('/data/marktext/plugin-host/word-counter/bootstrap.js')).toContain('const MAIN = "main.js"')

    await registry.syncServable(state({ 'word-counter': true }, true))
    expect(await backend.stat('/data/marktext/plugin-host/word-counter')).toBeNull()
    await registry.syncServable(state({ 'word-counter': true }))
    await registry.syncServable(state({ 'word-counter': false }))
    expect(await backend.stat('/data/marktext/plugin-host/word-counter')).toBeNull()
  })

  it('records grants, forgets them on reinstall and uninstalls everything', async() => {
    const { backend, registry } = await setup()
    for (const [name, data] of fixtureFiles()) backend.put(`/vault/docs/word-counter/${name}`, data)
    await registry.installFolder('/vault/docs/word-counter')
    await registry.grant('word-counter')
    expect(registry.get('word-counter')?.grantedPermissions).toEqual(['editor:read', 'ui:sidebar'])

    const reloaded = new MobileCommunityRegistry({
      backend, userDataPath: '/data/marktext', builtinIds: [], appVersion: '0.21.0', log: () => {}
    })
    await reloaded.load()
    expect(reloaded.get('word-counter')?.grantedPermissions).toEqual(['editor:read', 'ui:sidebar'])

    await registry.installFolder('/vault/docs/word-counter')
    expect(registry.get('word-counter')?.grantedPermissions).toEqual([])

    await registry.syncServable(state({ 'word-counter': true }))
    await registry.uninstall('word-counter')
    expect(registry.records()).toEqual([])
    expect(await backend.stat('/data/marktext/plugins/word-counter')).toBeNull()
    expect(await backend.stat('/data/marktext/plugin-host/word-counter')).toBeNull()
  })

  it('refuses a plugin that reuses a built-in id', async() => {
    const { backend, registry } = await setup()
    for (const [name, data] of fixtureFiles()) {
      const text = name === 'manifest.json' ? new TextDecoder().decode(data).replace('"word-counter"', '"links"') : data
      backend.put(`/vault/docs/fake/${name}`, text)
    }
    await expect(registry.installFolder('/vault/docs/fake')).rejects.toThrow()
    expect(registry.records()).toEqual([])
  })
})
