import type { VaultApi } from '../types'
import { unwrapIpcResult } from './errors'

export type VaultBridge = Omit<VaultAPI, 'setActiveFile'>

export interface VaultApiOptions {
  bridge: VaultBridge
  /**
   * Replaces the markdown of the tab showing `pathname` in this window as an
   * unsaved, undoable edit; false when no tab shows it.
   */
  updateOpenTab(pathname: string, markdown: string): boolean
}

/**
 * `VaultApi` over the preload `vault` bridge. Main enforces the folder scope
 * of every call; writes to a file open in a tab of this window go to that tab
 * instead, after main confirmed the path is inside the vault.
 */
export const createVaultApi = ({ bridge, updateOpenTab }: VaultApiOptions): VaultApi => ({
  readText: async(path) => unwrapIpcResult(await bridge.readText(path)),
  readBinary: async(path, maxBytes) => unwrapIpcResult(await bridge.readBinary(path, maxBytes)),
  writeText: async(path, content, options) => {
    // Rejects with OUTSIDE_VAULT before an open tab could be touched.
    unwrapIpcResult(await bridge.exists(path))
    if (updateOpenTab(path, content)) return { mtimeMs: null }
    return unwrapIpcResult(await bridge.writeText(path, content, options?.expectedMtimeMs))
  },
  createText: async(path, content) => {
    unwrapIpcResult(await bridge.createText(path, content))
  },
  exists: async(path) => unwrapIpcResult(await bridge.exists(path)),
  list: async(options) =>
    unwrapIpcResult(await bridge.list(options?.extensions ? [...options.extensions] : undefined))
})
