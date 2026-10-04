import { h } from 'vue'
import { ElMessageBox } from 'element-plus'
import { generateGithubSlug } from '@muyajs/core'
import type { RendererPluginContext } from '@/plugins/types'
import { getLinkExtension } from 'common/markdownExt'
import { isMarkdownPath } from '../common/paths'
import type { WikilinkData } from '../common/syntax'
import type { VaultFiles } from './vaultFiles'

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const dirnameOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')

const joinPath = (folder: string, relative: string): string => {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  return [folder.replace(/[\\/]+$/, ''), ...relative.split('/').filter(Boolean)].join(sep)
}

/**
 * Absolute path a link target resolves to from `sourcePath`: the vault
 * index once it is ready, else the cached folder listing, else a
 * `<target>.md` file next to the source.
 */
export const resolveTarget = async(
  ctx: RendererPluginContext,
  files: VaultFiles,
  target: string,
  sourcePath: string | null
): Promise<string | null> => {
  if (ctx.metadata.isReady() && sourcePath) {
    const resolved = await ctx.metadata.resolveLink(target, sourcePath).catch(() => null)
    if (resolved) return resolved
  }
  const cached = files.resolve(target, sourcePath)
  if (cached) return cached
  if (!sourcePath) return null
  const candidate = joinPath(dirnameOf(sourcePath), getLinkExtension(target) ? target : `${target}.md`)
  return (await ctx.vault.exists(candidate).catch(() => false)) ? candidate : null
}

/** Where a new note for an unresolved target goes: next to the current note, or under the folder root for `Folder/Note` targets. */
export const newNotePath = (files: VaultFiles, target: string, sourcePath: string | null): string | null => {
  const name = getLinkExtension(target) ? target : `${target}.md`
  const root = files.getRoot()
  if (target.includes('/') && root) return joinPath(root, name)
  const folder = sourcePath ? dirnameOf(sourcePath) : root
  return folder ? joinPath(folder, name) : null
}

const confirm = async(ctx: RendererPluginContext, message: string): Promise<boolean> => {
  try {
    await ElMessageBox.confirm(h('p', message), ctx.t('create.title'), {
      confirmButtonText: ctx.t('create.confirm'),
      cancelButtonText: ctx.t('create.cancel'),
      type: 'info',
      customClass: 'links-plugin-dialog'
    })
    return true
  } catch {
    return false
  }
}

/** Follows a clicked wikilink; offers to create the note when it does not resolve. */
export const openWikilink = async(ctx: RendererPluginContext, files: VaultFiles, data: WikilinkData): Promise<void> => {
  const sourcePath = ctx.editor.getActiveTab()?.pathname ?? null
  const target = data.target ?? ''
  try {
    if (!target) {
      if (sourcePath && data.heading) await ctx.workspace.openFile(sourcePath, { anchor: generateGithubSlug(data.heading) })
      return
    }
    const resolved = await resolveTarget(ctx, files, target, sourcePath)
    if (resolved) {
      if (isMarkdownPath(resolved)) {
        await ctx.workspace.openFile(resolved, data.heading ? { anchor: generateGithubSlug(data.heading) } : undefined)
      } else {
        await ctx.workspace.openFile(resolved, data.subpath ? { subpath: data.subpath } : undefined)
      }
      return
    }
  } catch (error) {
    ctx.ui.notify({ type: 'error', message: ctx.t('open.failed', { message: errorMessage(error) }) })
    return
  }

  const pathname = newNotePath(files, target, sourcePath)
  if (!pathname || !isMarkdownPath(pathname)) {
    ctx.ui.notify({ type: 'warning', message: ctx.t('open.failed', { message: target }) })
    return
  }
  if (!(await confirm(ctx, ctx.t('create.message', { name: target })))) return
  try {
    await ctx.workspace.createAndOpenFile(pathname, '')
    files.scheduleRefresh()
  } catch (error) {
    ctx.ui.notify({ type: 'error', message: ctx.t('create.failed', { message: errorMessage(error) }) })
  }
}
