import { describe, expect, it } from 'vitest'
import { walkEntries, walkFiles, type DirEntry, type FileBackend } from '../src/main/fs/backend'
import { MemoryFileBackend } from '../src/main/fs/memoryBackend'

describe('walkEntries', () => {
  it('lists every nested file once, sorted, skipping hidden folders and node_modules', async() => {
    const files: Record<string, string> = {}
    for (let d = 0; d < 6; d++) {
      for (let f = 0; f < 4; f++) files[`/vault/k/V/d${d}/sub/n${f}.md`] = 'x'
      files[`/vault/k/V/d${d}/top.md`] = 'x'
    }
    files['/vault/k/V/.obsidian/workspace.json'] = '{}'
    files['/vault/k/V/node_modules/pkg/readme.md'] = 'x'
    const backend = new MemoryFileBackend(files)
    const paths = await walkFiles(backend, '/vault/k/V', (p) => p.endsWith('.md'))
    const expected = Object.keys(files).filter((p) => p.endsWith('.md') && !p.includes('node_modules')).sort()
    expect(paths).toEqual(expected)
  })

  it('hands back the listing entries, so callers can skip a stat per file', async() => {
    const backend = new MemoryFileBackend({ '/vault/k/V/a.md': 'x' })
    const listed: DirEntry = { name: 'a.md', isFile: true, isDirectory: false, size: 7, mtimeMs: 42 }
    const withSizes: FileBackend = Object.assign(Object.create(backend) as FileBackend, {
      readdir: async(): Promise<DirEntry[]> => [listed]
    })
    expect(await walkEntries(withSizes, '/vault/k/V', () => true)).toEqual([{ path: '/vault/k/V/a.md', entry: listed }])
  })
})
