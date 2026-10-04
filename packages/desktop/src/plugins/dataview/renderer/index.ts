import type { RendererPluginModule } from '@/plugins/types'
import { DataviewViews } from './view'
import './style.css'

const plugin: RendererPluginModule = {
  activate(ctx) {
    const views = new DataviewViews(ctx)
    ctx.editor.registerCodeBlockRenderer({
      lang: ['dataview'],
      render: (container, { source }) => views.mount(container, source),
      exportHtml: (source) => views.exportHtml(source)
    })
  }
}

export default plugin
