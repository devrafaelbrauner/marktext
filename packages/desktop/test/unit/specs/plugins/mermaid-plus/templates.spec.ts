import mermaid from 'mermaid'
import { describe, expect, it } from 'vitest'
import { locales } from '@plugins/mermaid-plus/locales'
import { DIAGRAM_KINDS, diagramTemplate } from '@plugins/mermaid-plus/common/templates'
import type { PluginLocaleMessages } from '@shared/plugins/types'

// Looks `key` up in a plugin locale bundle and fails on a missing string, so a
// template can never show a raw key.
const translator = (messages: PluginLocaleMessages) => (key: string): string => {
  const value = key.split('.').reduce<string | PluginLocaleMessages | undefined>(
    (node, part) => (typeof node === 'object' ? node[part] : undefined),
    messages
  )
  if (typeof value !== 'string') throw new Error(`missing string ${key}`)
  return value
}

describe('mermaid-plus diagram templates', () => {
  it.each(['en', 'pt'])('every %s template is valid mermaid of its kind', async(language) => {
    const t = translator((locales[language] ?? {}))
    const types: string[] = []
    for (const kind of DIAGRAM_KINDS) {
      const source = diagramTemplate(kind, t)
      // Throws with the parse error on invalid source.
      const { diagramType } = await mermaid.parse(source)
      types.push(diagramType)
    }
    expect(types).toEqual([
      'flowchart-v2',
      'sequence',
      'class',
      'stateDiagram',
      'er',
      'gantt',
      'pie',
      'mindmap',
      'timeline',
      'quadrantChart'
    ])
  })

  it('uses the localized labels', () => {
    const source = diagramTemplate('flowchart', translator((locales.pt ?? {})))
    expect(source.split('\n')[0]).toBe('flowchart TD')
    expect(source).toContain('A["Início"] --> B{"Tudo pronto?"}')
  })

  it('offers a title for every kind in both languages', () => {
    for (const language of ['en', 'pt']) {
      const t = translator((locales[language] ?? {}))
      for (const kind of DIAGRAM_KINDS) expect(t(`commands.${kind}`)).toMatch(/\S/)
    }
    expect(translator((locales.pt ?? {}))('commands.flowchart')).toBe('Inserir diagrama: fluxograma')
  })
})
