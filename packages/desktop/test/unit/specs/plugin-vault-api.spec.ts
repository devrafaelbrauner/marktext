import { describe, it, expect, vi } from 'vitest'
import { createVaultApi, type VaultBridge } from '@/plugins/host/vaultApi'

const outsideVault = { ok: false as const, error: { code: 'OUTSIDE_VAULT' as const, message: 'outside' } }

const createBridge = (overrides: Partial<VaultBridge> = {}): VaultBridge => ({
  readText: vi.fn(),
  readBinary: vi.fn(),
  writeText: vi.fn(async() => ({ ok: true as const, value: { mtimeMs: 42 } })),
  createText: vi.fn(),
  exists: vi.fn(async() => ({ ok: true as const, value: true })),
  list: vi.fn(),
  ...overrides
})

describe('renderer vault API', () => {
  it('writes a file open in a tab through the tab, not the disk', async() => {
    const bridge = createBridge()
    const updateOpenTab = vi.fn(() => true)
    const vault = createVaultApi({ bridge, updateOpenTab })
    await expect(vault.writeText('/vault/a.md', '# new', { expectedMtimeMs: 1 })).resolves.toEqual({ mtimeMs: null })
    expect(updateOpenTab).toHaveBeenCalledWith('/vault/a.md', '# new')
    expect(bridge.writeText).not.toHaveBeenCalled()
  })

  it('writes closed files on disk with the expected mtime', async() => {
    const bridge = createBridge()
    const vault = createVaultApi({ bridge, updateOpenTab: () => false })
    await expect(vault.writeText('/vault/a.md', 'x', { expectedMtimeMs: 7 })).resolves.toEqual({ mtimeMs: 42 })
    expect(bridge.writeText).toHaveBeenCalledWith('/vault/a.md', 'x', 7)
  })

  it('never touches an open tab outside the vault', async() => {
    const bridge = createBridge({ exists: vi.fn(async() => outsideVault) })
    const updateOpenTab = vi.fn(() => true)
    const vault = createVaultApi({ bridge, updateOpenTab })
    await expect(vault.writeText('/etc/passwd', 'x')).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' })
    expect(updateOpenTab).not.toHaveBeenCalled()
  })

  it('rejects with the code main reported', async() => {
    const bridge = createBridge({
      readBinary: vi.fn(async() => ({ ok: false as const, error: { code: 'TOO_LARGE' as const, message: 'big' } }))
    })
    const vault = createVaultApi({ bridge, updateOpenTab: () => false })
    await expect(vault.readBinary('/vault/doc.pdf', 10)).rejects.toMatchObject({ code: 'TOO_LARGE', message: 'big' })
  })
})
