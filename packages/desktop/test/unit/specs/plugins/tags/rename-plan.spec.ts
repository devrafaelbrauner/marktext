import { describe, expect, it } from 'vitest'
import { PluginError } from '@/plugins/host/errors'
import { applyTagRename, planTagRename, type RenameServices } from '@plugins/tags/renderer/renamePlan'

interface DiskFile {
  content: string
  mtimeMs: number
}

/**
 * Vault with `VaultApi` semantics: writes to the open tab go to the tab and
 * return a null mtime; disk writes check `expectedMtimeMs`.
 */
const createVault = (files: Record<string, string>, tagged: string[]) => {
  const disk = new Map<string, DiskFile>(Object.entries(files).map(([path, content]) => [path, { content, mtimeMs: 1 }]))
  const state = { open: null as { pathname: string; markdown: string } | null }
  const services: RenameServices = {
    metadata: { getFilesWithTag: async() => [...tagged] },
    vault: {
      readText: async(path) => {
        const file = disk.get(path)
        if (!file) throw new PluginError('NOT_FOUND', `${path} does not exist`)
        return { ...file }
      },
      writeText: async(path, content, options) => {
        if (state.open?.pathname === path) {
          state.open = { pathname: path, markdown: content }
          return { mtimeMs: null }
        }
        const file = disk.get(path)
        if (options?.expectedMtimeMs !== undefined && file?.mtimeMs !== options.expectedMtimeMs) {
          throw new PluginError('CONFLICT', `${path} changed on disk`)
        }
        const mtimeMs = (file?.mtimeMs ?? 0) + 1
        disk.set(path, { content, mtimeMs })
        return { mtimeMs }
      }
    },
    getOpenDocument: () => state.open,
    isInVault: (path) => path.startsWith('/vault/')
  }
  return { disk, state, services }
}

describe('tags: planTagRename', () => {
  it('lists every affected note with its occurrence count, sorted by path', async() => {
    const { services } = createVault(
      {
        '/vault/b.md': '#old and #old/x\n',
        '/vault/a.md': '---\ntags: [old]\n---\n\nText\n',
        '/vault/stale.md': 'no tag any more\n'
      },
      ['/vault/b.md', '/vault/a.md', '/vault/stale.md']
    )
    const plan = await planTagRename(services, 'old', 'new')
    expect(plan.files.map((file) => [file.path, file.count, file.mtimeMs])).toEqual([
      ['/vault/a.md', 1, 1],
      ['/vault/b.md', 2, 1]
    ])
    expect(plan.occurrences).toBe(3)
    expect(plan.files[1].content).toBe('#new and #new/x\n')
    expect(plan.skipped).toEqual([])
  })

  it('reads the active tab from the editor, including tags not saved yet', async() => {
    const { services, state } = createVault({ '/vault/open.md': 'saved text\n' }, [])
    state.open = { pathname: '/vault/open.md', markdown: 'unsaved #old\n' }
    const plan = await planTagRename(services, 'old', 'new')
    expect(plan.files).toEqual([{ path: '/vault/open.md', count: 1, content: 'unsaved #new\n', mtimeMs: null }])
  })

  it('ignores an active tab outside the vault', async() => {
    const { services, state } = createVault({}, [])
    state.open = { pathname: '/elsewhere/x.md', markdown: '#old\n' }
    expect((await planTagRename(services, 'old', 'new')).files).toEqual([])
  })

  it('reports files that cannot be read instead of failing', async() => {
    const { services } = createVault({ '/vault/a.md': '#old\n' }, ['/vault/a.md', '/vault/gone.md'])
    const plan = await planTagRename(services, 'old', 'new')
    expect(plan.files.map((file) => file.path)).toEqual(['/vault/a.md'])
    expect(plan.skipped).toEqual([{ path: '/vault/gone.md', message: '/vault/gone.md does not exist' }])
  })
})

describe('tags: applyTagRename', () => {
  it('writes unchanged files and reports files changed on disk since the preview as conflicts', async() => {
    const { services, disk } = createVault(
      { '/vault/a.md': '#old\n', '/vault/b.md': 'B #old\n' },
      ['/vault/a.md', '/vault/b.md']
    )
    const plan = await planTagRename(services, 'old', 'new')
    disk.set('/vault/b.md', { content: 'B #old edited elsewhere\n', mtimeMs: 7 })

    const outcome = await applyTagRename(services, plan)
    expect(outcome).toEqual({ renamed: ['/vault/a.md'], conflicts: ['/vault/b.md'], failed: [] })
    expect(disk.get('/vault/a.md')?.content).toBe('#new\n')
    expect(disk.get('/vault/b.md')?.content).toBe('B #old edited elsewhere\n')
  })

  it('recomputes the active tab from its current text so later typing is kept', async() => {
    const { services, state } = createVault({}, [])
    state.open = { pathname: '/vault/open.md', markdown: '#old\n' }
    const plan = await planTagRename(services, 'old', 'new')
    state.open = { pathname: '/vault/open.md', markdown: '#old typed after the preview\n' }

    const outcome = await applyTagRename(services, plan)
    expect(outcome.renamed).toEqual(['/vault/open.md'])
    expect(state.open).toEqual({ pathname: '/vault/open.md', markdown: '#new typed after the preview\n' })
  })

  it('treats a tab closed since the preview as a conflict', async() => {
    const { services, state } = createVault({}, [])
    state.open = { pathname: '/vault/open.md', markdown: '#old\n' }
    const plan = await planTagRename(services, 'old', 'new')
    state.open = null
    expect(await applyTagRename(services, plan)).toEqual({ renamed: [], conflicts: ['/vault/open.md'], failed: [] })
  })

  it('reports other write errors separately', async() => {
    const { services } = createVault({ '/vault/a.md': '#old\n' }, ['/vault/a.md'])
    const plan = await planTagRename(services, 'old', 'new')
    services.vault.writeText = async() => {
      throw new PluginError('OUTSIDE_VAULT', 'outside the folder')
    }
    expect(await applyTagRename(services, plan)).toEqual({
      renamed: [],
      conflicts: [],
      failed: [{ path: '/vault/a.md', message: 'outside the folder' }]
    })
  })
})
