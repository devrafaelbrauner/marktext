import type { RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import { getMarkersForLanguage, isKanbanMarkdown } from '../common/board'
import { matchObsidianComment } from '../common/comment'
import { createBoardMarkdown, toBoardFileName } from '../common/newBoard'
import { openDialog } from './dialog'
import KanbanView from './KanbanView.vue'
import { dirnameOf, joinPath } from './links'
import './styles.css'

const BOARD_VIEW_ID = 'kanban.board'

const createNewBoard = async(ctx: RendererPluginContext): Promise<void> => {
  const t = ctx.t
  const activePath = ctx.editor.getActiveTab()?.pathname ?? null
  const activeFolder = activePath ? dirnameOf(activePath) : null
  const root = ctx.workspace.getRootPath()
  const rootPrefix = root?.replace(/[/\\]+$/, '')
  // File access is limited to the opened folder: a file opened from elsewhere falls back to its root.
  const insideRoot = !!activeFolder && !!rootPrefix &&
    (activeFolder === rootPrefix || activeFolder.startsWith(`${rootPrefix}/`) || activeFolder.startsWith(`${rootPrefix}\\`))
  const folder = activeFolder && (!root || insideRoot) ? activeFolder : root
  if (!folder) {
    ctx.ui.notify({ type: 'warning', message: t('newBoard.noFolder') })
    return
  }
  const name = await openDialog({
    title: t('newBoard.title'),
    input: { label: t('newBoard.nameLabel'), value: t('newBoard.defaultName') },
    confirmText: t('newBoard.create'),
    cancelText: t('dialog.cancel')
  })
  if (name === null) return

  try {
    const base = toBoardFileName(name.trim() || t('newBoard.defaultName')).replace(/\.md$/, '')
    let pathname = joinPath(folder, `${base}.md`)
    for (let suffix = 1; await ctx.vault.exists(pathname); suffix++) {
      pathname = joinPath(folder, `${base} ${suffix}.md`)
    }
    const lanes = [t('newBoard.lanes.todo'), t('newBoard.lanes.doing'), t('newBoard.lanes.done')]
    await ctx.workspace.createAndOpenFile(pathname, createBoardMarkdown(lanes, getMarkersForLanguage(ctx.language.value)))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.ui.notify({ type: 'error', message: t('newBoard.failed', { message }) })
  }
}

const plugin: RendererPluginModule = {
  activate(ctx) {
    ctx.workspace.registerTabView({
      id: BOARD_VIEW_ID,
      kind: 'markdown',
      title: 'view.title',
      component: KanbanView,
      matches: isKanbanMarkdown
    })

    ctx.commands.register({
      id: 'kanban.new-board',
      title: 'commands.newBoard',
      run: () => createNewBoard(ctx)
    })

    ctx.editor.registerInlineSyntax({
      name: 'obsidian-comment',
      precedence: 'beforeEmphasis',
      match(src, prevChar) {
        const length = matchObsidianComment(src, prevChar)
        return length === null ? null : { length, contentStart: 0, contentEnd: length, data: {} }
      },
      noSpellcheck: true,
      // Obsidian leaves comments out of rendered output.
      exportHtml: () => ''
    })
  }
}

export default plugin
