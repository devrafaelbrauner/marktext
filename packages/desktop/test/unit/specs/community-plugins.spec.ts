import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { deflateRawSync, crc32 } from 'zlib'
import { describe, expect, it } from 'vitest'
import { METHOD_PERMISSIONS, authorize, dispatchRpc } from '@shared/plugins/community'
import { validateCommunityManifest } from '@shared/plugins/communitySchema'
import { installFromFolder, installFromZip } from '../../../src/main/community/installer'
import { resolvePluginFile, safeRelativePath } from '../../../src/main/community/paths'
import { servePluginUrl } from '../../../src/main/community/serve'
import { readZip, safeZipEntryName } from '../../../src/main/community/zip'
import { ActivationWatch } from '../../../src/renderer/src/plugins/community/activation'

const validManifest = {
  id: 'word-counter',
  name: 'Word counter',
  version: '1.0.0',
  minAppVersion: '0.21.0',
  author: 'MarkText Plus',
  description: { en: 'Counts words', pt: 'Conta palavras' },
  main: 'main.js',
  permissions: ['editor:read', 'ui:sidebar'],
  panels: [{ id: 'word-counter', title: 'Words', icon: '<svg></svg>', entry: 'panel.html' }],
  settings: [{ key: 'countCode', label: 'Count code', type: 'boolean', default: true }]
}

const zipOf = (entries: Array<{ name: string; data: string; mode?: number }>): Buffer => {
  const u16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
  const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.from(entry.data)
    const compressed = deflateRawSync(data)
    const name = Buffer.from(entry.name)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc32(data)), u32(compressed.length), u32(data.length),
      u16(name.length), u16(0), name, compressed
    ])
    locals.push(local)
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc32(data)), u32(compressed.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32((entry.mode ?? 0) << 16), u32(offset), name
    ]))
    offset += local.length
  }
  const central = Buffer.concat(centrals)
  return Buffer.concat([
    ...locals,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0)
  ])
}

describe('community manifest', () => {
  it('accepts a schema-valid manifest', () => {
    expect(validateCommunityManifest(validManifest, { appVersion: '0.21.0-dev', builtinIds: ['links'] }).ok).toBe(true)
  })

  it('rejects a built-in id, an unknown permission and a missing field', () => {
    expect(validateCommunityManifest({ ...validManifest, id: 'links' }, { builtinIds: ['links'] }).ok).toBe(false)
    expect(validateCommunityManifest({ ...validManifest, permissions: ['vault:exec'] }).ok).toBe(false)
    const { id: _id, ...rest } = validManifest
    expect(validateCommunityManifest(rest).ok).toBe(false)
    expect(validateCommunityManifest({ ...validManifest, main: '../main.js' }).ok).toBe(false)
  })
})

describe('community zip', () => {
  it('rejects zip-slip names, absolute paths and symlink entries', () => {
    expect(safeZipEntryName('../evil.txt')).toBeNull()
    expect(safeZipEntryName('foo/../../etc/passwd')).toBeNull()
    expect(safeZipEntryName('/etc/passwd')).toBeNull()
    expect(safeZipEntryName('main.js')).toBe('main.js')
    expect(() => readZip(zipOf([{ name: '../evil.txt', data: 'x' }]))).toThrow(/escapes/)
    expect(() => readZip(zipOf([{ name: 'link', data: '/etc/passwd', mode: 0o120777 }]))).toThrow(/symlink/)
  })

  it('does not write a slipped entry outside the destination', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mt-zip-'))
    const zipPath = path.join(root, 'bad.zip')
    writeFileSync(zipPath, zipOf([{ name: '../evil.txt', data: 'owned' }]))
    expect(() => installFromZip(zipPath, { pluginsRoot: path.join(root, 'plugins'), appVersion: '0.21.0' })).toThrow(/escapes/)
    expect(existsSync(path.join(root, 'evil.txt'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('community scheme', () => {
  it('rejects traversal and symlinks that leave the plugin directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mt-scheme-'))
    const pluginsRoot = path.join(root, 'plugins')
    const plugin = path.join(pluginsRoot, 'ok')
    const outside = path.join(root, 'secret.txt')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(path.join(plugin, 'main.js'), 'export {}')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, path.join(plugin, 'escape.txt'))
    expect(safeRelativePath('/%2e%2e%2f%2e%2e%2fetc/passwd')).toBeNull()
    expect(resolvePluginFile(plugin, 'escape.txt')).toBeNull()
    const served = servePluginUrl({
      url: 'mt-plugin://ok/main.js',
      pluginsRoot,
      isServable: () => true,
      bootstrapScript: () => 'bootstrap'
    })
    expect(served.status).toBe(200)
    expect(served.headers['Content-Security-Policy']).toContain("script-src 'unsafe-inline' mt-plugin://ok")
    expect(served.headers['Content-Security-Policy']).toContain("connect-src 'none'")
    expect(servePluginUrl({
      url: 'mt-plugin://ok/escape.txt',
      pluginsRoot,
      isServable: () => true,
      bootstrapScript: () => null
    }).status).toBe(404)
    expect(servePluginUrl({
      url: 'mt-plugin://ok/%2e%2e%2fsecret.txt',
      pluginsRoot,
      isServable: () => true,
      bootstrapScript: () => null
    }).status).toBe(400)
    expect(servePluginUrl({
      url: 'mt-plugin://ok/main.js',
      pluginsRoot,
      isServable: () => false,
      bootstrapScript: () => null
    }).status).toBe(403)
    expect(servePluginUrl({
      url: 'mt-plugin://ok/__mt/bootstrap.js',
      pluginsRoot,
      isServable: () => true,
      bootstrapScript: () => 'host-bootstrap'
    }).body.toString()).toBe('host-bootstrap')
    rmSync(root, { recursive: true, force: true })
  })
})

describe('community permissions', () => {
  it('denies every method that lacks its permission and allows it when granted', () => {
    for (const [method, permission] of Object.entries(METHOD_PERMISSIONS)) {
      if (permission === 'always') {
        expect(authorize(method, []).ok).toBe(true)
        continue
      }
      if (permission === 'network') {
        expect(authorize(method, [], [{ url: 'https://api.example.com/v1' }]).ok).toBe(false)
        expect(authorize(method, ['network:api.example.com'], [{ url: 'https://api.example.com/v1' }]).ok).toBe(true)
        expect(authorize(method, ['network:other.example'], [{ url: 'https://api.example.com/v1' }]).ok).toBe(false)
        continue
      }
      const denied = authorize(method, [])
      if (denied.ok) throw new Error(`${method} should be denied`)
      expect(denied.code).toBe('PERMISSION_DENIED')
      expect(authorize(method, [permission]).ok).toBe(true)
    }
    const unknown = authorize('editor.exec', [])
    if (unknown.ok) throw new Error('unknown method should fail')
    expect(unknown.code).toBe('UNKNOWN_METHOD')
  })
})

describe('community RPC', () => {
  it('returns permission, argument and handler errors without throwing', async() => {
    const denied = await dispatchRpc(
      { id: 1, method: 'vault.readText', args: [{ path: '/tmp/x' }] },
      { granted: [], call: async() => 'nope' }
    )
    expect(denied).toEqual({
      id: 1,
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: expect.stringContaining('vault:read') }
    })
    const malformed = await dispatchRpc(
      { id: 2, method: 'notify', args: 'nope' },
      { granted: [], call: async() => null }
    )
    expect(malformed).toMatchObject({ id: 2, ok: false, error: { code: 'BAD_ARGS' } })
    const failed = await dispatchRpc(
      { id: 3, method: 'notify', args: [{ message: 'hi' }] },
      {
        granted: [],
        call: async() => {
          throw Object.assign(new Error('disk'), { code: 'NOT_FOUND' })
        }
      }
    )
    expect(failed).toEqual({ id: 3, ok: false, error: { code: 'NOT_FOUND', message: 'disk' } })
    expect(await dispatchRpc({ event: 'activated' }, { granted: [], call: async() => null })).toBeNull()
  })
})

describe('community activation timeout', () => {
  it('fires once and ignores a late activation', () => {
    const fired: Array<() => void> = []
    const timeouts: string[] = []
    const watch = new ActivationWatch(10_000, () => timeouts.push('timeout'), (fn) => {
      fired.push(fn)
      return 1
    }, () => {
      fired.length = 0
    })
    watch.arm()
    expect(fired).toHaveLength(1)
    fired[0]?.()
    expect(timeouts).toEqual(['timeout'])
    expect(watch.activate()).toBe(false)
  })
})

describe('community install', () => {
  it('rejects a built-in id and installs a valid folder', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mt-install-'))
    const source = path.join(root, 'src')
    mkdirSync(source)
    writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ ...validManifest, id: 'links' }))
    writeFileSync(path.join(source, 'main.js'), 'export {}')
    writeFileSync(path.join(source, 'panel.html'), '<div></div>')
    expect(() => installFromFolder(source, {
      pluginsRoot: path.join(root, 'plugins'),
      appVersion: '0.21.0',
      builtinIds: ['links']
    })).toThrow(/built-in/)
    writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(validManifest))
    const manifest = installFromFolder(source, {
      pluginsRoot: path.join(root, 'plugins'),
      appVersion: '0.21.0',
      builtinIds: ['links']
    })
    expect(manifest.id).toBe('word-counter')
    expect(readFileSync(path.join(root, 'plugins', 'word-counter', 'main.js'), 'utf8')).toContain('export')
    rmSync(root, { recursive: true, force: true })
  })
})
