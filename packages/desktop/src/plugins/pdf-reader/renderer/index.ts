import { defineAsyncComponent } from 'vue'
import type { RendererPluginModule } from '@/plugins/types'
import { copyPageLink } from './copyLink'
import { VIEW_ID } from './session'

const plugin: RendererPluginModule = {
  activate(ctx) {
    ctx.workspace.registerTabView({
      id: VIEW_ID,
      kind: 'asset',
      extensions: ['pdf'],
      title: 'view.title',
      // Lazy so pdf.js (~1 MB) is only loaded once a PDF is opened.
      component: defineAsyncComponent(() => import('./PdfViewer.vue'))
    })
    ctx.commands.register({
      id: 'pdf-reader.copy-page-link',
      title: 'commands.copyPageLink',
      run: () => copyPageLink(ctx)
    })
  }
}

export default plugin
