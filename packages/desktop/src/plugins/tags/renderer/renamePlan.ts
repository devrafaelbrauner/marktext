import type { MetadataApi, RendererPluginContext, VaultApi } from '@/plugins/types'
import { renameTagInMarkdown } from '../common/rename'

export interface RenameServices {
  metadata: Pick<MetadataApi, 'getFilesWithTag'>
  vault: Pick<VaultApi, 'readText' | 'writeText'>
  /** Path and current markdown of the active tab, when it shows a markdown file that has a path. */
  getOpenDocument(): { pathname: string; markdown: string } | null
  /** Whether `path` lies inside the folder of this window. */
  isInVault(path: string): boolean
}

export const createRenameServices = (ctx: RendererPluginContext): RenameServices => ({
  metadata: ctx.metadata,
  vault: ctx.vault,
  getOpenDocument: () => {
    const tab = ctx.editor.getActiveTab()
    const markdown = ctx.editor.getMarkdown()
    return tab && tab.kind === 'markdown' && tab.pathname && markdown !== null
      ? { pathname: tab.pathname, markdown }
      : null
  },
  isInVault: (path) => {
    const root = ctx.workspace.getRootPath()
    return !!root && (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))
  }
})

export interface RenamePlanFile {
  path: string
  /** Renamed occurrences in this file. */
  count: number
  /** The rewritten note. */
  content: string
  /** Disk mtime of the content the rewrite started from, or null when it came from the open tab. */
  mtimeMs: number | null
}

export interface RenamePlan {
  from: string
  to: string
  files: RenamePlanFile[]
  occurrences: number
  /** Files listed by the index that could not be read. */
  skipped: Array<{ path: string; message: string }>
}

export interface RenameOutcome {
  renamed: string[]
  /** Changed on disk (or their tab closed) after the preview; left untouched. */
  conflicts: string[]
  failed: Array<{ path: string; message: string }>
}

const errorCode = (error: unknown): string | null =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const WRITE_CONCURRENCY = 8

const forEachLimited = async <T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> => {
  let next = 0
  const worker = async(): Promise<void> => {
    while (next < items.length) await run(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, items.length) }, worker))
}

/**
 * Computes the rewrite of every note the index lists for `from` (nested tags
 * included) without writing anything. The active tab is read from the editor,
 * so its unsaved edits are kept and a tag typed there but not saved yet is
 * found as well.
 */
export const planTagRename = async(services: RenameServices, from: string, to: string): Promise<RenamePlan> => {
  const paths = [...(await services.metadata.getFilesWithTag(from, { includeNested: true }))]
  const open = services.getOpenDocument()
  if (open && !paths.includes(open.pathname) && services.isInVault(open.pathname)) paths.push(open.pathname)

  const plan: RenamePlan = { from, to, files: [], occurrences: 0, skipped: [] }
  await forEachLimited(paths, async(path) => {
    try {
      const source =
        open && open.pathname === path
          ? { content: open.markdown, mtimeMs: null }
          : await services.vault.readText(path)
      const result = renameTagInMarkdown(source.content, from, to)
      if (result.count === 0) return
      plan.files.push({ path, count: result.count, content: result.content, mtimeMs: source.mtimeMs })
      plan.occurrences += result.count
    } catch (error) {
      plan.skipped.push({ path, message: errorMessage(error) })
    }
  })
  plan.files.sort((a, b) => a.path.localeCompare(b.path))
  plan.skipped.sort((a, b) => a.path.localeCompare(b.path))
  return plan
}

/**
 * Writes a previewed plan. Disk files are written only if unchanged since the
 * preview (`expectedMtimeMs`); a file that is open in a tab gets the edit as
 * an unsaved, undoable change. The active tab's rewrite is recomputed from
 * its current text, so typing after the preview is not lost.
 */
export const applyTagRename = async(services: RenameServices, plan: RenamePlan): Promise<RenameOutcome> => {
  const outcome: RenameOutcome = { renamed: [], conflicts: [], failed: [] }
  await forEachLimited(plan.files, async(file) => {
    try {
      if (file.mtimeMs === null) {
        const open = services.getOpenDocument()
        if (!open || open.pathname !== file.path) {
          outcome.conflicts.push(file.path)
          return
        }
        const result = renameTagInMarkdown(open.markdown, plan.from, plan.to)
        if (result.count > 0) await services.vault.writeText(file.path, result.content)
      } else {
        await services.vault.writeText(file.path, file.content, { expectedMtimeMs: file.mtimeMs })
      }
      outcome.renamed.push(file.path)
    } catch (error) {
      if (errorCode(error) === 'CONFLICT') outcome.conflicts.push(file.path)
      else outcome.failed.push({ path: file.path, message: errorMessage(error) })
    }
  })
  outcome.renamed.sort()
  outcome.conflicts.sort()
  outcome.failed.sort((a, b) => a.path.localeCompare(b.path))
  return outcome
}
