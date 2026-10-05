import { afterEach, describe, expect, it } from 'vitest'
import { MemoryFileBackend } from '../src/main/fs/memoryBackend'
import { VaultFiles } from '../src/main/plugins/vault'
import { fsChanged, type FsChange } from '../src/main/state'

const setup = (root: string | null = '/vault/k') => {
  const backend = new MemoryFileBackend({
    '/vault/k/a.md': '# A',
    '/vault/k/sub/b.md': 'b',
    '/vault/k/.hidden/c.md': 'c',
    '/vault/k/img.png': 'png',
    '/vault/other/secret.md': 'secret'
  })
  const changes: FsChange[] = []
  const stop = fsChanged.on((change) => changes.push(change))
  cleanups.push(stop)
  return { backend, changes, vault: new VaultFiles(backend, () => root) }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('plugin vault access', () => {
  it('reads inside the scope and rejects paths outside it, relative ones and no scope at all', async() => {
    const { vault } = setup()
    await expect(vault.readText('/vault/k/sub/b.md')).resolves.toMatchObject({ content: 'b' })
    await expect(vault.readText('/vault/other/secret.md')).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' })
    await expect(vault.readText('/vault/k/../other/secret.md')).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' })
    await expect(vault.readText('/vault/kk/a.md')).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' })
    await expect(vault.readText('a.md')).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' })
    await expect(vault.exists('/data/marktext/plugins.json')).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' })
    await expect(setup(null).vault.readText('/vault/k/a.md')).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' })
  })

  it('rejects a stale expectedMtimeMs with CONFLICT and leaves the file alone', async() => {
    const { vault, backend } = setup()
    const { mtimeMs } = await vault.readText('/vault/k/a.md')
    const first = await vault.writeText('/vault/k/a.md', '# A2', mtimeMs)
    expect(first.mtimeMs).toBeGreaterThan(mtimeMs)
    await expect(vault.writeText('/vault/k/a.md', '# stale', mtimeMs)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await backend.readText('/vault/k/a.md')).toBe('# A2')
    await expect(vault.writeText('/vault/k/new.md', 'x', 123)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('writes a new file only into an existing folder and reports every change', async() => {
    const { vault, changes } = setup()
    await expect(vault.writeText('/vault/k/missing/x.md', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const { mtimeMs } = await vault.writeText('/vault/k/sub/new.md', 'n')
    await vault.writeText('/vault/k/a.md', 'changed')
    expect(changes).toEqual([
      { type: 'add', pathname: '/vault/k/sub/new.md', mtimeMs },
      expect.objectContaining({ type: 'change', pathname: '/vault/k/a.md' })
    ])
  })

  it('creates files with their folders, refusing anything that exists', async() => {
    const { vault, backend, changes } = setup()
    await expect(vault.createText('/vault/k/a.md', 'x')).rejects.toMatchObject({ code: 'EXISTS' })
    await vault.createText('/vault/k/daily/2026/10-04.md', '# Today')
    expect(await backend.readText('/vault/k/daily/2026/10-04.md')).toBe('# Today')
    expect(changes.map((change) => `${change.type} ${change.pathname}`)).toEqual([
      'addDir /vault/k/daily',
      'addDir /vault/k/daily/2026',
      'add /vault/k/daily/2026/10-04.md'
    ])
  })

  it('caps binary reads', async() => {
    const { vault } = setup()
    await expect(vault.readBinary('/vault/k/img.png', 2)).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect([...(await vault.readBinary('/vault/k/img.png'))]).toEqual([112, 110, 103])
  })

  it('lists visible files of the scope, filtered by extension', async() => {
    const { vault } = setup()
    expect((await vault.list(['MD'])).map((entry) => entry.path)).toEqual(['/vault/k/a.md', '/vault/k/sub/b.md'])
    expect((await vault.list()).map((entry) => entry.name).sort()).toEqual(['a.md', 'b.md', 'img.png'])
  })
})
