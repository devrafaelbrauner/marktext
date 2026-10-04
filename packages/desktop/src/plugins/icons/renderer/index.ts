import type { Disposable, RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import { createLazyValue } from '../common/loader'
import type { IconPack } from '../common/pack'
import { createIconSyntaxRule, type IconExportMode } from '../common/rule'
import { searchIcons } from '../common/search'
import { findIconShortcodes, formatShortcode, LUCIDE_PREFIX } from '../common/shortcode'
import { IconStyleSheet } from './iconStyles'
import { openIconPicker } from './picker'

// Dynamic import on purpose: it puts the ~600 KB icon set in its own chunk,
// fetched on first use. Shared by every activation of the plugin in this
// window, so re-enabling it does not parse the icon set again.
const lucide = createLazyValue<IconPack>(() => import('./lucide').then((m) => m.default))

const COMPLETION_LIMIT = 50
const RESCAN_DELAY_MS = 300

const activate = (ctx: RendererPluginContext): void => {
  const styles = new IconStyleSheet(document)
  let disposed = false
  let rule: Disposable | null = null
  let rescanTimer: number | undefined
  let closePicker: (() => void) | null = null
  let loadErrorShown = false

  ctx.track({
    dispose: () => {
      disposed = true
      window.clearTimeout(rescanTimer)
      closePicker?.()
      styles.dispose()
    }
  })

  // The inline rule only exists once the pack is loaded: before that every
  // shortcode is left to the emoji rule, and registering it makes the host
  // re-render the open document with icons.
  const loadPack = async(): Promise<IconPack | null> => {
    try {
      const pack = await lucide.load()
      if (disposed) return null
      styles.setPack(pack)
      rule ??= ctx.editor.registerInlineSyntax(
        createIconSyntaxRule(pack, {
          getExportMode: () => ctx.settings.get<IconExportMode>('exportMode'),
          onMatch: (name) => styles.add(name)
        })
      )
      return pack
    } catch (err) {
      if (!disposed && !loadErrorShown) {
        loadErrorShown = true
        ctx.ui.notify({
          type: 'error',
          message: ctx.t('errors.loadFailed', { message: err instanceof Error ? err.message : String(err) })
        })
      }
      return null
    }
  }

  // Styles follow the icons of the active document; the scan also triggers
  // the first load as soon as a document contains a Lucide shortcode.
  const rescan = (): void => {
    const markdown = ctx.editor.getMarkdown()
    if (!markdown || !markdown.includes(`:${LUCIDE_PREFIX}-`)) {
      styles.replace([])
      return
    }
    // `loadPack` reports its own failures and resolves null.
    loadPack().then((pack) => {
      if (pack) styles.replace(findIconShortcodes(markdown, pack.prefix, (name) => !!pack.get(name)))
    })
  }

  ctx.editor.onDidSetContent(rescan)
  ctx.editor.onDidChangeActiveTab(rescan)
  ctx.editor.onDidChangeContent(() => {
    window.clearTimeout(rescanTimer)
    rescanTimer = window.setTimeout(rescan, RESCAN_DELAY_MS)
  })
  rescan()

  ctx.editor.registerCompletionProvider({
    id: 'icons.lucide',
    trigger: /:(lucide-[a-z0-9-]*)$/,
    // Typing inside an existing shortcode replaces its rest as well.
    consumeAfter: /^[a-z0-9-]*:/,
    getItems: async(query) => {
      const pack = await loadPack()
      if (!pack) return []
      return searchIcons(pack, query.slice(pack.prefix.length + 1), COMPLETION_LIMIT).map((name) => ({
        label: name,
        detail: pack.get(name)?.keywords.slice(0, 3).join(', '),
        insertText: formatShortcode(pack.prefix, name)
      }))
    }
  })

  ctx.commands.register({
    id: 'icons.insert',
    title: 'commands.insert',
    // CmdOrCtrl+Shift+I is the app's "Image" format shortcut.
    keybinding: 'CmdOrCtrl+Alt+Shift+I',
    run: async() => {
      if (closePicker) return
      if (ctx.editor.getActiveTab()?.kind !== 'markdown') {
        ctx.ui.notify({ type: 'info', message: ctx.t('errors.noDocument') })
        return
      }
      const pack = await loadPack()
      if (!pack || disposed || closePicker) return
      const restoreFocus = (): void => {
        closePicker = null
        ctx.editor.getMuya()?.focus()
      }
      closePicker = openIconPicker({
        pack,
        t: (key, params) => ctx.t(key, params),
        maskUri: (name) => styles.maskUri(name),
        onPick: (name) => {
          restoreFocus()
          ctx.editor.insertText(formatShortcode(pack.prefix, name))
        },
        onCancel: restoreFocus
      })
    }
  })
}

const plugin: RendererPluginModule = { activate }

export default plugin
