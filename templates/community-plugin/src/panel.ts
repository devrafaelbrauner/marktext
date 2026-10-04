import { definePanel } from '@marktext-plus/plugin-sdk'
import { countSections } from './count'

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

definePanel(async(api, root) => {
  const render = async(): Promise<void> => {
    const markdown = await api.editor.getMarkdown()
    const countCode = await api.settings.get('countCode')
    const sections = countSections(markdown ?? '', countCode !== false)
    const items = sections.map((section) =>
      `<li class="word-counter-section" data-title="${escapeHtml(section.title)}"><span class="title">${escapeHtml(section.title)}</span><span class="count">${section.words}</span></li>`
    ).join('')
    root.innerHTML = `<h1>Word count</h1><ul class="word-counter-sections">${items}</ul>`
  }
  await render()
  await api.editor.onDidChangeContent(() => { render().catch(() => {}) })
  await api.editor.onDidSetContent(() => { render().catch(() => {}) })
})
