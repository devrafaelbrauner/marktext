import { shallowRef } from 'vue'
import { createLinkResolver, type LinkResolver } from 'common/markdownExt'
import type { RendererPluginContext } from '@/plugins/types'
import { toAbsolutePath, toVaultPath } from '../common/paths'

const REFRESH_DELAY_MS = 200

/**
 * Every file of the window's folder (notes and attachments) with a link
 * resolver over it. The link rules are the index's (createLinkResolver), but
 * the list comes straight from the vault so resolution also works before the
 * index finished its first scan and right after a rename.
 */
export class VaultFiles {
  /** Vault-relative POSIX paths; replaced (not mutated) on refresh, so it can be watched. */
  readonly paths = shallowRef<string[]>([])
  private resolver: LinkResolver = createLinkResolver([])
  private timer: number | undefined
  private pending: Promise<void> | null = null
  private disposed = false

  constructor(private readonly ctx: RendererPluginContext) {}

  /** Folder the vault API is scoped to: the opened folder, else the active file's folder. */
  getRoot(): string | null {
    const root = this.ctx.workspace.getRootPath()
    if (root) return root
    const active = this.ctx.editor.getActiveTab()?.pathname
    return active ? active.replace(/[\\/][^\\/]*$/, '') : null
  }

  toVault(absolute: string): string | null {
    const root = this.getRoot()
    return root ? toVaultPath(root, absolute) : null
  }

  toAbsolute(vaultPath: string): string | null {
    const root = this.getRoot()
    return root ? toAbsolutePath(root, vaultPath) : null
  }

  getResolver(): LinkResolver {
    return this.resolver
  }

  /** Absolute path `target` resolves to from the note at absolute `sourcePath`, using the cached file list. */
  resolve(target: string, sourcePath: string | null): string | null {
    const source = sourcePath ? this.toVault(sourcePath) : ''
    if (source === null) return null
    const hit = this.resolver.resolve(target, source)
    return hit === null ? null : this.toAbsolute(hit)
  }

  /** Re-lists the folder after a short delay; calls in quick succession share one listing. */
  scheduleRefresh(): void {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = undefined
      this.refresh()
    }, REFRESH_DELAY_MS)
  }

  refresh(): Promise<void> {
    if (this.pending) return this.pending.then(() => this.refresh())
    this.pending = this.load().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.timer)
  }

  private async load(): Promise<void> {
    const root = this.getRoot()
    let next: string[] = []
    if (root) {
      try {
        const entries = await this.ctx.vault.list()
        next = entries.map((entry) => toVaultPath(root, entry.path)).filter((path): path is string => !!path)
      } catch {
        next = []
      }
    }
    if (this.disposed) return
    this.resolver = createLinkResolver(next)
    this.paths.value = next
  }
}
