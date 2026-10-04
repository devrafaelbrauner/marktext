import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarkdownToHtml, registerInlineSyntax } from '@muyajs/core'
import { tokenizer } from '@muyajs/core/inlineRenderer/lexer'
import { createIconPack, type IconPack } from '@plugins/icons/common/pack'
import { createIconSyntaxRule, type IconExportMode } from '@plugins/icons/common/rule'
import { findIconShortcodes, matchIconShortcode } from '@plugins/icons/common/shortcode'

const pack: IconPack = createIconPack(
  'lucide',
  {
    house: [['path', { d: 'M3 10v11h18V10' }]],
    'arrow-up': [['path', { d: 'm5 12 7-7 7 7' }], ['line', { x1: '12', x2: '12', y1: '5', y2: '19' }]]
  },
  { house: ['home'], 'arrow-up': ['direction'] }
)
const known = (name: string): boolean => !!pack.get(name)

describe('matchIconShortcode', () => {
  it('claims a known icon as one marker-only token', () => {
    expect(matchIconShortcode(':lucide-house: and more', '', 'lucide', known)).toEqual({
      length: 14,
      contentStart: 0,
      contentEnd: 0,
      data: { icon: 'house' }
    })
    expect(matchIconShortcode(':lucide-arrow-up:', ' ', 'lucide', known)?.data.icon).toBe('arrow-up')
  })

  it('leaves unknown names, other prefixes and emoji shortcodes alone', () => {
    expect(matchIconShortcode(':lucide-nope:', '', 'lucide', known)).toBeNull()
    expect(matchIconShortcode(':fa-house:', '', 'lucide', known)).toBeNull()
    expect(matchIconShortcode(':smile:', '', 'lucide', known)).toBeNull()
    expect(matchIconShortcode(':lucide-house', '', 'lucide', known)).toBeNull()
    expect(matchIconShortcode(':lucide-House:', '', 'lucide', known)).toBeNull()
  })

  it('requires the opening colon to sit at a word boundary', () => {
    expect(matchIconShortcode(':lucide-house:', 'a', 'lucide', known)).toBeNull()
    expect(matchIconShortcode(':lucide-house:', '1', 'lucide', known)).toBeNull()
    expect(matchIconShortcode(':lucide-house:', '(', 'lucide', known)).not.toBeNull()
    expect(matchIconShortcode(':lucide-house:', ':', 'lucide', known)).not.toBeNull()
  })
})

describe('findIconShortcodes', () => {
  it('collects known icons once, honouring the word boundary', () => {
    const markdown = 'a :lucide-house: b :lucide-house::lucide-arrow-up: x:lucide-nope: y:lucide-arrow-up:'
    expect([...findIconShortcodes(markdown, 'lucide', known)]).toEqual(['house', 'arrow-up'])
    expect(findIconShortcodes('12:lucide-house: :lucide-missing:', 'lucide', known).size).toBe(0)
  })
})

describe('icon inline syntax in the engine', () => {
  let exportMode: IconExportMode = 'svg'
  let matched: string[] = []
  let unregister: () => void

  beforeEach(() => {
    exportMode = 'svg'
    matched = []
    unregister = registerInlineSyntax(
      createIconSyntaxRule(pack, { getExportMode: () => exportMode, onMatch: (name) => matched.push(name) })
    )
  })

  afterEach(() => unregister())

  const customTokens = (text: string) =>
    tokenizer(text).filter((token) => token.type === 'custom_inline')

  it('tokenizes known shortcodes and leaves unknown ones to the emoji rule', () => {
    const tokens = tokenizer('Go :lucide-house: or :lucide-nope: :smile:')
    const icon = tokens.find((token) => token.type === 'custom_inline')
    expect(icon).toMatchObject({ name: 'icon', raw: ':lucide-house:', data: { icon: 'house' } })
    expect(tokens.filter((token) => token.type === 'emoji').map((token) => token.raw)).toEqual([
      ':lucide-nope:',
      ':smile:'
    ])
    expect(matched).toEqual(['house'])
  })

  it('does not match inside inline code or glued to a word', () => {
    expect(customTokens('`:lucide-house:` and a:lucide-house:')).toEqual([])
  })

  it('matches inside emphasis', () => {
    const [strong] = tokenizer('**:lucide-arrow-up:**')
    expect(strong.type).toBe('strong')
    const children = ('children' in strong ? strong.children : undefined) ?? []
    expect(children.map((child) => child.type)).toContain('custom_inline')
  })

  it('exports inline SVG, or the shortcode in shortcode mode, never inside code', async() => {
    const svgHtml = await new MarkdownToHtml('A :lucide-house: `:lucide-house:`').renderHtml()
    expect(svgHtml).toMatch(/<svg[^>]*class="mt-icon"[^>]*>/)
    expect(svgHtml).toContain('aria-hidden="true"')
    expect(svgHtml).toContain('width="1em"')
    expect(svgHtml).toContain('<path d="M3 10v11h18V10"')
    expect(svgHtml).toContain('<code>:lucide-house:</code>')

    exportMode = 'shortcode'
    const textHtml = await new MarkdownToHtml('A :lucide-house:').renderHtml()
    expect(textHtml).not.toContain('<svg')
    expect(textHtml).toContain(':lucide-house:')
  })
})
