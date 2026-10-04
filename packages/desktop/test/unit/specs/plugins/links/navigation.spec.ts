import { describe, expect, it, vi } from 'vitest'
import type { RendererPluginContext } from '@/plugins/types'
import { newNotePath, resolveTarget } from '@plugins/links/renderer/navigation'
import { VaultFiles } from '@plugins/links/renderer/vaultFiles'

const ROOT = '/vault'

const fakeContext = (options: { ready: boolean; indexed?: string | null; files: string[]; existing?: string[] }) => {
  const resolveLink = vi.fn(async() => options.indexed ?? null)
  const exists = vi.fn(async(path: string) => (options.existing ?? []).includes(path))
  const ctx = {
    workspace: { getRootPath: () => ROOT },
    editor: { getActiveTab: () => null },
    metadata: { isReady: () => options.ready, resolveLink },
    vault: { exists, list: async() => options.files.map((path) => ({ path, name: '', extension: '', size: 0, mtimeMs: 0 })) }
  }
  // Only the members the navigation helpers read are provided.
  const typed = ctx as unknown as RendererPluginContext
  return { ctx: typed, resolveLink, exists }
}

describe('link resolution fallback', () => {
  it('asks the index once it is ready', async() => {
    const { ctx, resolveLink } = fakeContext({ ready: true, indexed: '/vault/Projects/Alpha.md', files: [] })
    const files = new VaultFiles(ctx)
    expect(await resolveTarget(ctx, files, 'Alpha', '/vault/Home.md')).toBe('/vault/Projects/Alpha.md')
    expect(resolveLink).toHaveBeenCalledWith('Alpha', '/vault/Home.md')
  })

  it('uses the folder listing before the index is ready', async() => {
    const { ctx, resolveLink } = fakeContext({ ready: false, files: ['/vault/Home.md', '/vault/Projects/Alpha.md'] })
    const files = new VaultFiles(ctx)
    await files.refresh()
    expect(await resolveTarget(ctx, files, 'alpha', '/vault/Home.md')).toBe('/vault/Projects/Alpha.md')
    expect(resolveLink).not.toHaveBeenCalled()
  })

  it('falls back to a same-folder note checked through the vault', async() => {
    const { ctx, exists } = fakeContext({ ready: false, files: [], existing: ['/vault/Daily/Fresh.md'] })
    const files = new VaultFiles(ctx)
    expect(await resolveTarget(ctx, files, 'Fresh', '/vault/Daily/2026-10-01.md')).toBe('/vault/Daily/Fresh.md')
    expect(await resolveTarget(ctx, files, 'Gone', '/vault/Daily/2026-10-01.md')).toBeNull()
    expect(exists).toHaveBeenLastCalledWith('/vault/Daily/Gone.md')
  })

  it('places new notes next to the current one, or under the root for paths', () => {
    const { ctx } = fakeContext({ ready: false, files: [] })
    const files = new VaultFiles(ctx)
    expect(newNotePath(files, 'Missing Note', '/vault/Projects/Alpha.md')).toBe('/vault/Projects/Missing Note.md')
    expect(newNotePath(files, 'Area/Topic', '/vault/Projects/Alpha.md')).toBe('/vault/Area/Topic.md')
    expect(newNotePath(files, 'Loose', null)).toBe('/vault/Loose.md')
  })
})
