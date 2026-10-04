import { defineComponent, h } from 'vue'
import tagsIcon from 'lucide-static/icons/tags.svg?raw'
import type { RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import {
  exportHashtagHtml,
  HASHTAG_SYNTAX,
  matchHashtag,
  rankTagCompletions,
  TAG_COMPLETION_CONSUME_AFTER,
  TAG_COMPLETION_TRIGGER
} from '../common/syntax'
import { createTagsStore, TAGS_PANEL_ID } from './store'
import TagsPanel from './TagsPanel.vue'
import './hashtag.css'

const plugin: RendererPluginModule = {
  activate(ctx) {
    const store = createTagsStore(ctx)

    // Keeps `#tag` at the start of a paragraph a paragraph; headings need `# `.
    ctx.editor.requestEngineOptions({ atxHeadingRequiresSpace: true })

    ctx.editor.registerInlineSyntax({
      name: HASHTAG_SYNTAX,
      precedence: 'afterHtml',
      noSpellcheck: true,
      match: matchHashtag,
      exportHtml: exportHashtagHtml
    })

    ctx.editor.onDidClickInlineToken(HASHTAG_SYNTAX, ({ data, event }) => {
      if (!data.tag) return
      event.preventDefault()
      store.revealTag(data.tag)
    })

    ctx.editor.registerCompletionProvider({
      id: 'tags.hashtag',
      trigger: TAG_COMPLETION_TRIGGER,
      consumeAfter: TAG_COMPLETION_CONSUME_AFTER,
      getItems: (query) =>
        rankTagCompletions(store.tags.value, query).map((entry) => ({
          label: `#${entry.tag}`,
          detail: String(entry.count),
          insertText: `#${entry.tag} `
        }))
    })

    const panel = defineComponent({
      name: 'TagsPanelHost',
      props: { ctx: { type: Object as () => RendererPluginContext, required: true } },
      setup: (props) => () => h(TagsPanel, { ctx: props.ctx, store })
    })
    ctx.ui.registerSidebarPanel({ id: TAGS_PANEL_ID, title: 'panel.title', icon: tagsIcon, component: panel, order: 10 })

    ctx.commands.register({
      id: 'tags.showPanel',
      title: 'commands.showPanel',
      run: () => ctx.ui.revealSidebarPanel(TAGS_PANEL_ID)
    })
    ctx.commands.register({
      id: 'tags.renameTag',
      title: 'commands.rename',
      run: () => store.requestRename()
    })
  }
}

export default plugin
