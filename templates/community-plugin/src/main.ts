import { definePlugin } from '@marktext-plus/plugin-sdk'
import { countSections, totalWords } from './count'

definePlugin({
  async activate(api) {
    await api.commands.register({
      id: 'word-counter.count',
      title: 'Count words in sections',
      async run() {
        const markdown = await api.editor.getMarkdown()
        const countCode = await api.settings.get('countCode')
        const sections = countSections(markdown ?? '', countCode !== false)
        await api.notify({ message: `Counted ${totalWords(sections)} words`, type: 'info' })
      }
    })
    await api.editor.registerCodeBlockRenderer({
      lang: ['wordcount'],
      render({ source }) {
        return `<p class="wordcount-preview">Words: ${totalWords(countSections(source, true))}</p>`
      }
    })
  }
})
