import { defineComponent, h, watch } from 'vue'
import type { CompletionItem, DecorationRange, RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import { rankPaths } from '../common/completion'
import { linkTextFor, type NewLinkFormat } from '../common/linkText'
import { isMarkdownPath, noteName } from '../common/paths'
import { scanDocumentLinks } from '../common/scan'
import { exportWikilinkHtml, matchWikilinkToken } from '../common/syntax'
import BacklinksPanel from './BacklinksPanel.vue'
import { openWikilink } from './navigation'
import { updateLinksAfterRename } from './renameUpdates'
import { VaultFiles } from './vaultFiles'
import './links.css'

const PANEL_ID = 'links.backlinks'
const UNRESOLVED_LAYER = 'unresolved'
const DECORATION_DELAY_MS = 250
const MAX_HEADING_ITEMS = 50

// lucide "link-2"
const PANEL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>'

const activeMarkdownPath = (ctx: RendererPluginContext): string | null => {
  const tab = ctx.editor.getActiveTab()
  return tab?.kind === 'markdown' ? tab.pathname : null
}

/** Marks wikilinks of the active document whose target does not resolve against the folder listing. */
const updateUnresolved = (ctx: RendererPluginContext, vault: VaultFiles): void => {
  const tab = ctx.editor.getActiveTab()
  if (!tab || tab.kind !== 'markdown' || tab.viewId || !vault.getRoot()) {
    ctx.editor.clearDecorations(UNRESOLVED_LAYER)
    return
  }
  const source = tab.pathname ? vault.toVault(tab.pathname) : ''
  if (source === null) {
    ctx.editor.clearDecorations(UNRESOLVED_LAYER)
    return
  }
  const resolver = vault.getResolver()
  const ranges: DecorationRange[] = []
  for (const block of ctx.editor.getCheckableBlocks()) {
    if (!block.text.includes('[[')) continue
    for (const { start, end, link } of scanDocumentLinks(block.text).wikilinks) {
      if (!link.target || resolver.resolve(link.target, source) !== null) continue
      ranges.push({ path: block.path, start, end, className: 'mu-links-unresolved', data: { target: link.target } })
    }
  }
  ctx.editor.setDecorations(UNRESOLVED_LAYER, ranges)
}

const fileItems = (ctx: RendererPluginContext, vault: VaultFiles, query: string): CompletionItem[] => {
  const active = activeMarkdownPath(ctx)
  const source = active ? vault.toVault(active) ?? '' : ''
  const format = ctx.settings.get<NewLinkFormat>('newLinkFormat')
  const resolver = vault.getResolver()
  return rankPaths(query, vault.paths.value.filter((path) => path !== source)).map((path) => {
    const text = linkTextFor(path, source, resolver, format)
    const label = noteName(path)
    return { label, detail: text === label ? undefined : path, insertText: `[[${text}]]` }
  })
}

const headingItems = async(ctx: RendererPluginContext, vault: VaultFiles, query: string): Promise<CompletionItem[]> => {
  const hash = query.indexOf('#')
  const note = query.slice(0, hash)
  const filter = query.slice(hash + 1).trim().toLowerCase()
  const active = activeMarkdownPath(ctx)
  const resolved = note.trim() ? vault.resolve(note.trim(), active) : active
  if (!resolved || !isMarkdownPath(resolved)) return []
  const meta = await ctx.metadata.getFile(resolved).catch(() => null)
  if (!meta) return []
  return meta.headings
    .filter((heading) => heading.text.toLowerCase().includes(filter))
    .slice(0, MAX_HEADING_ITEMS)
    .map((heading) => ({
      label: heading.text,
      detail: `${'#'.repeat(heading.level)} ${noteName(meta.path.replace(/\\/g, '/'))}`,
      insertText: `[[${note}#${heading.text}]]`
    }))
}

const plugin: RendererPluginModule = {
  activate(ctx) {
    const vault = new VaultFiles(ctx)
    ctx.track({ dispose: () => vault.dispose() })

    let decorationTimer: number | undefined
    const scheduleDecorations = (): void => {
      window.clearTimeout(decorationTimer)
      decorationTimer = window.setTimeout(() => updateUnresolved(ctx, vault), DECORATION_DELAY_MS)
    }
    ctx.track({ dispose: () => window.clearTimeout(decorationTimer) })
    const refreshFiles = (): void => vault.scheduleRefresh()
    const stopWatchingFiles = watch(vault.paths, scheduleDecorations)
    ctx.track({ dispose: stopWatchingFiles })

    ctx.editor.registerInlineSyntax({
      name: 'wikilink',
      precedence: 'beforeEmphasis',
      match: matchWikilinkToken,
      noSpellcheck: true,
      exportHtml: (_raw, data) => exportWikilinkHtml(data)
    })
    ctx.editor.onDidClickInlineToken('wikilink', ({ data }) => {
      openWikilink(ctx, vault, data)
    })

    ctx.editor.registerCompletionProvider({
      id: 'links.files',
      trigger: /\[\[([^\]|#\n]*)$/,
      consumeAfter: /^\]\]/,
      // Synchronous once the listing is loaded, so the list follows keystrokes without async gaps.
      getItems: (query) =>
        vault.paths.value.length
          ? fileItems(ctx, vault, query)
          : vault.refresh().then(() => fileItems(ctx, vault, query))
    })
    ctx.editor.registerCompletionProvider({
      id: 'links.headings',
      trigger: /\[\[([^\]|#\n]*#[^\]|#\n]*)$/,
      consumeAfter: /^\]\]/,
      getItems: (query) => headingItems(ctx, vault, query)
    })

    ctx.editor.onDidChangeContent(scheduleDecorations)
    ctx.editor.onDidSetContent(scheduleDecorations)
    ctx.editor.onDidChangeActiveTab(() => {
      refreshFiles()
      scheduleDecorations()
    })
    ctx.workspace.onDidChangeRootPath(refreshFiles)
    ctx.metadata.onDidBecomeReady(refreshFiles)
    ctx.metadata.onDidChange((event) => {
      const known = new Set(vault.paths.value)
      if (event.removed.length || event.changed.some((path) => !known.has(vault.toVault(path) ?? ''))) refreshFiles()
    })
    ctx.workspace.onDidRenameFile((event) => {
      updateLinksAfterRename(ctx, vault, event).finally(scheduleDecorations)
    })

    ctx.ui.registerSidebarPanel({
      id: PANEL_ID,
      title: 'panel.title',
      icon: PANEL_ICON,
      order: 10,
      component: defineComponent({
        name: 'LinksBacklinksPanelHost',
        props: { ctx: { type: Object, required: true } },
        setup: () => () => h(BacklinksPanel, { ctx, files: vault })
      })
    })
    ctx.commands.register({
      id: 'links.showBacklinks',
      title: 'commands.showBacklinks',
      run: () => ctx.ui.revealSidebarPanel(PANEL_ID)
    })

    vault.refresh()
  }
}

export default plugin
