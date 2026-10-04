import type { MermaidEngineOptions, RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import type { Disposable } from '@shared/plugins/types'
import { resolveDiagramLink } from '../common/links'
import { mermaidEngineOptions } from '../common/options'
import { DIAGRAM_KINDS, diagramTemplate, type DiagramKind } from '../common/templates'

const insertDiagram = (ctx: RendererPluginContext, kind: DiagramKind): void => {
  const muya = ctx.editor.getMuya()
  const selection = muya?.getSelection()
  if (!muya || !selection || selection.anchor.block.blockName !== 'paragraph.content') {
    ctx.ui.notify({ message: ctx.t('notify.noParagraph'), type: 'warning' })
    return
  }
  // Turns an empty paragraph into a mermaid block (or adds one below the
  // paragraph) with the caret inside, then types the example into it.
  muya.updateParagraph('mermaid')
  ctx.editor.insertText(diagramTemplate(kind, (key) => ctx.t(key)))
}

const openDiagramLink = async(ctx: RendererPluginContext, label: string): Promise<void> => {
  const rootPath = ctx.workspace.getRootPath()
  if (!rootPath) {
    ctx.ui.notify({ message: ctx.t('notify.noFolder'), type: 'warning' })
    return
  }
  const sourcePath = ctx.editor.getActiveTab()?.pathname ?? rootPath
  const target = await resolveDiagramLink(label, sourcePath, (link, source) => ctx.metadata.resolveLink(link, source))
  if (!target) {
    ctx.ui.notify({ message: ctx.t('notify.unresolved', { target: label }), type: 'warning' })
    return
  }
  await ctx.workspace.openFile(target.pathname, target.subpath ? { subpath: target.subpath } : undefined)
}

const activate = (ctx: RendererPluginContext): void => {
  let request: Disposable | null = null
  const applySettings = (): void => {
    const options: MermaidEngineOptions = mermaidEngineOptions(ctx.settings.get<string>('theme'), ctx.settings.get<string>('look'))
    request?.dispose()
    request = ctx.editor.requestEngineOptions({ mermaid: options })
  }
  applySettings()
  ctx.settings.onDidChange((key) => {
    if (key === 'theme' || key === 'look') applySettings()
  })

  ctx.editor.onDidClickInlineToken('mermaid-internal-link', ({ data }) => {
    if (data.target) openDiagramLink(ctx, data.target)
  })

  for (const kind of DIAGRAM_KINDS) {
    ctx.commands.register({
      id: `mermaid-plus.insert-${kind}`,
      title: `commands.${kind}`,
      run: () => insertDiagram(ctx, kind)
    })
  }
}

const plugin: RendererPluginModule = { activate }

export default plugin
