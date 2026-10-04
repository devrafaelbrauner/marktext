import { h } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { FileRenameEvent, RendererPluginContext } from '@/plugins/types'
import { isMarkdownPath, mapRenamedPath, noteName } from '../common/paths'
import { planRenameRewrites, type NoteSource, type PlannedRewrite } from '../common/rename'
import type { VaultFiles } from './vaultFiles'

export type UpdateLinksOnRename = 'ask' | 'always' | 'never'

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

interface LoadedNote extends NoteSource {
  absolute: string
  /** Disk modification time, or null when the content came from the active tab. */
  mtimeMs: number | null
}

/**
 * Notes worth reading: those whose indexed links name one of the moved files
 * (by file name) and the moved notes themselves. Without a ready index every
 * note is a candidate.
 */
const candidateNotes = async(
  ctx: RendererPluginContext,
  files: VaultFiles,
  notePaths: string[],
  movedPaths: string[],
  rename: { oldPath: string; newPath: string }
): Promise<string[]> => {
  if (!ctx.metadata.isReady()) return notePaths
  // Other notes still name the moved files by their old names.
  const movedNames = new Set(
    movedPaths.map((path) => noteName(mapRenamedPath(path, rename.newPath, rename.oldPath) ?? path).toLowerCase())
  )
  const moved = new Set(movedPaths)
  const indexed = await ctx.metadata.listFiles().catch(() => null)
  if (!indexed) return notePaths
  const hits = new Set<string>()
  for (const file of indexed) {
    const path = files.toVault(file.path)
    if (path === null) continue
    if (file.links.some((link) => movedNames.has(noteName(link.target.replace(/\\/g, '/')).toLowerCase()))) {
      // The index may not have seen the rename yet.
      hits.add(mapRenamedPath(path, rename.oldPath, rename.newPath) ?? path)
    }
  }
  return notePaths.filter((path) => hits.has(path) || moved.has(path))
}

const loadNotes = async(ctx: RendererPluginContext, files: VaultFiles, paths: string[]): Promise<LoadedNote[]> => {
  const active = ctx.editor.getActiveTab()
  const notes: LoadedNote[] = []
  for (const path of paths) {
    const absolute = files.toAbsolute(path)
    if (!absolute) continue
    if (active?.pathname === absolute && active.kind === 'markdown') {
      const markdown = ctx.editor.getMarkdown()
      if (markdown !== null) {
        notes.push({ path, absolute, content: markdown, mtimeMs: null })
        continue
      }
    }
    try {
      const { content, mtimeMs } = await ctx.vault.readText(absolute)
      notes.push({ path, absolute, content, mtimeMs })
    } catch {
      // Unreadable notes (deleted meanwhile, too large) keep their links.
    }
  }
  return notes
}

const confirmRewrites = async(ctx: RendererPluginContext, name: string, rewrites: PlannedRewrite[]): Promise<boolean> => {
  const count = rewrites.reduce((sum, rewrite) => sum + rewrite.count, 0)
  const message = h('div', { class: 'links-rename-confirm' }, [
    h('p', ctx.t('rename.message', { name, count })),
    h(
      'ul',
      rewrites.map((rewrite) => h('li', rewrite.path))
    )
  ])
  try {
    await ElMessageBox.confirm(message, ctx.t('rename.title'), {
      confirmButtonText: ctx.t('rename.confirm'),
      cancelButtonText: ctx.t('rename.cancel'),
      type: 'info',
      customClass: 'links-plugin-dialog'
    })
    return true
  } catch {
    return false
  }
}

/**
 * Keeps links pointing at a file or folder the app renamed or moved: plans
 * the rewrites over the post-rename folder listing, asks when configured to,
 * then writes each note through the vault (open tabs get an undoable edit).
 */
export const updateLinksAfterRename = async(
  ctx: RendererPluginContext,
  files: VaultFiles,
  event: FileRenameEvent
): Promise<void> => {
  const mode = ctx.settings.get<UpdateLinksOnRename>('updateLinksOnRename')
  if (mode === 'never') return
  const oldPath = files.toVault(event.oldPath)
  const newPath = files.toVault(event.newPath)
  if (oldPath === null || newPath === null) return

  await files.refresh()
  const paths = files.paths.value
  const rename = { oldPath, newPath }
  const movedPaths = paths.filter((path) => mapRenamedPath(path, newPath, newPath) !== null)
  if (!movedPaths.length) return
  const notePaths = paths.filter((path) => isMarkdownPath(path))
  const candidates = await candidateNotes(ctx, files, notePaths, movedPaths, rename)
  const notes = await loadNotes(ctx, files, candidates)
  const rewrites = planRenameRewrites(rename, paths, notes)
  if (!rewrites.length) return

  const name = noteName(oldPath)
  if (mode === 'ask' && !(await confirmRewrites(ctx, name, rewrites))) return

  const byPath = new Map(notes.map((note) => [note.path, note]))
  let written = 0
  let links = 0
  for (const rewrite of rewrites) {
    const note = byPath.get(rewrite.path)
    if (!note) continue
    try {
      await ctx.vault.writeText(
        note.absolute,
        rewrite.content,
        note.mtimeMs === null ? undefined : { expectedMtimeMs: note.mtimeMs }
      )
      written++
      links += rewrite.count
    } catch (error) {
      ctx.ui.notify({ type: 'error', message: ctx.t('rename.failed', { name: rewrite.path, message: errorMessage(error) }) })
    }
  }
  if (written) ctx.ui.notify({ type: 'info', message: ctx.t('rename.done', { count: links, files: written }) })
}
