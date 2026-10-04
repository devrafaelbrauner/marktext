import type { RendererPluginContext } from '@/plugins/types'
import { buildPageLink } from '../common/link'
import { VIEW_ID, viewStates } from './session'

/**
 * Copies `[[file.pdf#page=N]]` for `target`, or for the page shown by the
 * active PDF tab, through the app's clipboard bridge.
 */
export const copyPageLink = async(
  ctx: RendererPluginContext,
  target?: { pathname: string; page: number }
): Promise<void> => {
  if (!target) {
    const tab = ctx.editor.getActiveTab()
    if (!tab?.pathname || tab.kind !== 'asset' || tab.viewId !== VIEW_ID) {
      ctx.ui.notify({ message: ctx.t('notify.noPdf'), type: 'warning' })
      return
    }
    target = { pathname: tab.pathname, page: viewStates.get(tab.pathname)?.page ?? 1 }
  }
  const rootPath = ctx.workspace.getRootPath()
  let vaultFiles: string[] | null = null
  if (rootPath) {
    try {
      vaultFiles = (await ctx.vault.list({ extensions: ['pdf'] })).map((file) => file.path)
    } catch (err) {
      // Without the file list the full vault path is used, which always resolves.
      console.warn('[pdf-reader] listing the vault failed:', err)
    }
  }
  const link = buildPageLink({ absolutePath: target.pathname, rootPath, vaultFiles, page: target.page })
  window.electron.clipboard.writeText(link)
  ctx.ui.notify({ message: ctx.t('notify.linkCopied', { link }), type: 'info', timeout: 3000 })
}
