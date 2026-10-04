import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MarkdownToHtml, Muya, registerInlineSyntax } from '@muyajs/core'
import { tokenizer } from '@muyajs/core/inlineRenderer/lexer'
import type { TagCount } from '@shared/plugins/types'
import {
  exportHashtagHtml,
  HASHTAG_SYNTAX,
  matchHashtag,
  rankTagCompletions,
  TAG_COMPLETION_CONSUME_AFTER,
  TAG_COMPLETION_TRIGGER
} from '@plugins/tags/common/syntax'

interface TokenLike {
  type: string
  raw?: string
  name?: string
  data?: Record<string, string>
  children?: TokenLike[]
}

const flatten = (tokens: TokenLike[]): TokenLike[] =>
  tokens.flatMap((token) => [token, ...(Array.isArray(token.children) ? flatten(token.children) : [])])

const hashtags = (text: string): Array<{ raw: string; tag: string }> =>
  flatten(tokenizer(text) as TokenLike[])
    .filter((token) => token.type === 'custom_inline' && token.name === HASHTAG_SYNTAX)
    .map((token) => ({ raw: token.raw ?? '', tag: token.data?.tag ?? '' }))

describe('tags: matchHashtag', () => {
  it('matches Unicode, nested, emoji and underscore tags; the whole source is token text', () => {
    expect(matchHashtag('#reunião amanhã', '')).toEqual({
      length: 8,
      contentStart: 0,
      contentEnd: 8,
      data: { tag: 'reunião' }
    })
    expect(matchHashtag('#a/b/c.', ' ')?.data.tag).toBe('a/b/c')
    expect(matchHashtag('#Café_2', ' ')?.data.tag).toBe('Café_2')
    expect(matchHashtag('#emoji🙂 x', ' ')?.data.tag).toBe('emoji🙂')
  })

  it('keeps a trailing slash in the token length but not in the tag', () => {
    expect(matchHashtag('#a/b/ x', ' ')).toMatchObject({ length: 5, data: { tag: 'a/b' } })
  })

  it('rejects digits-only tags, hex colours and `#` without a boundary before it', () => {
    expect(matchHashtag('#123', ' ')).toBeNull()
    expect(matchHashtag('#2026-10', ' ')).toBeNull()
    expect(matchHashtag('#fff', ' ')).toBeNull()
    expect(matchHashtag('#1e1e1e', ' ')).toBeNull()
    expect(matchHashtag('#sharp', 'C')).toBeNull()
    expect(matchHashtag('#x', '#')).toBeNull()
    expect(matchHashtag('#39;', '&')).toBeNull()
    expect(matchHashtag('#anchor', '/')).toBeNull()
    expect(matchHashtag('# heading', '')).toBeNull()
  })

  it('accepts punctuation before the `#`', () => {
    expect(matchHashtag('#paren)', '(')?.data.tag).toBe('paren')
    expect(matchHashtag('#dot', '.')?.data.tag).toBe('dot')
  })
})

describe('tags: engine rendering', () => {
  let unregister: () => void
  beforeAll(() => {
    unregister = registerInlineSyntax({
      name: HASHTAG_SYNTAX,
      precedence: 'afterHtml',
      noSpellcheck: true,
      match: matchHashtag,
      exportHtml: exportHashtagHtml
    })
  })
  afterAll(() => unregister())

  it('tokenizes the valid tags of the fixture vault edge-case line', () => {
    expect(hashtags('Valid: #reunião #a/b/c #Café_2 #emoji🙂 and (#paren) plus end.#dot')).toEqual([
      { raw: '#reunião', tag: 'reunião' },
      { raw: '#a/b/c', tag: 'a/b/c' },
      { raw: '#Café_2', tag: 'Café_2' },
      { raw: '#emoji🙂', tag: 'emoji🙂' },
      { raw: '#paren', tag: 'paren' },
      { raw: '#dot', tag: 'dot' }
    ])
  })

  it('never tokenizes tags in code, math, URLs, link destinations, HTML or escapes', () => {
    expect(hashtags('`#code` $#math$ https://example.com/#anchor #123 #fff #1e1e1e C#sharp')).toEqual([])
    expect(hashtags('<https://example.com/#auto> and [x](Notes.md#heading)')).toEqual([])
    expect(hashtags('<span title="#html">inline html</span>')).toEqual([])
    expect(hashtags('Escaped: \\#escaped')).toEqual([])
    expect(hashtags('[[Note#Heading]] and ![img](a.png#frag)')).toEqual([])
  })

  it('tokenizes a tag at the start of a paragraph', () => {
    expect(hashtags('#reunião amanhã')).toEqual([{ raw: '#reunião', tag: 'reunião' }])
  })

  it('renders a paragraph-start tag as a pill span whose text is the source', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const muya = new Muya(host, { markdown: '#reunião amanhã e #a/b/c\n\n`#code` [x](a.md#h)\n' } as ConstructorParameters<
      typeof Muya
    >[1])
    muya.init()
    try {
      const paragraphs = muya.domNode.querySelectorAll('p')
      expect(paragraphs).toHaveLength(2)
      const spans = [...muya.domNode.querySelectorAll<HTMLElement>('span.mu-inline-hashtag')]
      expect(spans.map((span) => [span.textContent, span.dataset.tag, span.getAttribute('spellcheck')])).toEqual([
        ['#reunião', 'reunião', 'false'],
        ['#a/b/c', 'a/b/c', 'false']
      ])
      expect(paragraphs[0].textContent).toBe('#reunião amanhã e #a/b/c')
      expect(muya.getMarkdown()).toBe('#reunião amanhã e #a/b/c\n\n`#code` [x](a.md#h)\n')
    } finally {
      muya.destroy()
      host.remove()
    }
  })

  it('exports tags as escaped `span.tag` elements', async() => {
    const html = await new MarkdownToHtml('Plan #reunião and #a/b/ then `#code`\n').renderHtml()
    expect(html).toContain('<span class="tag">#reunião</span>')
    expect(html).toContain('<span class="tag">#a/b</span>/')
    expect(html).not.toContain('<span class="tag">#code</span>')
  })
})

describe('tags: exportHashtagHtml', () => {
  it('escapes the tag text', () => {
    expect(exportHashtagHtml('#a&b', { tag: 'a&b' })).toBe('<span class="tag">#a&#38;b</span>')
  })
})

describe('tags: completion trigger', () => {
  const query = (textBeforeCaret: string): string | null => {
    const match = TAG_COMPLETION_TRIGGER.exec(textBeforeCaret)
    return match ? match[1] : null
  }

  it('matches `#` plus tag characters at the start of a paragraph or after whitespace', () => {
    expect(query('#reuni')).toBe('reuni')
    expect(query('Notes for #proj')).toBe('proj')
    expect(query('first line\n#idea/pro')).toBe('idea/pro')
    expect(query('#reunião')).toBe('reunião')
  })

  it('matches after punctuation', () => {
    expect(query('(#par')).toBe('par')
    expect(query('end.#do')).toBe('do')
    expect(query('a, #b')).toBe('b')
  })

  it('starts the replaced range at the `#`, not at the boundary character', () => {
    const match = TAG_COMPLETION_TRIGGER.exec('see (#par')
    expect(match?.index).toBe(5)
  })

  it('does not match heading markers or a bare `#`', () => {
    expect(query('#')).toBeNull()
    expect(query('# ')).toBeNull()
    expect(query('# Title')).toBeNull()
    expect(query('## Title')).toBeNull()
    expect(query('##tag')).toBeNull()
    expect(query('### ')).toBeNull()
  })

  it('does not match inside words, entities, URL paths, escapes or after a backtick', () => {
    expect(query('C#shar')).toBeNull()
    expect(query('&#39')).toBeNull()
    expect(query('https://example.com/#anc')).toBeNull()
    expect(query('\\#esc')).toBeNull()
    expect(query('`#code')).toBeNull()
  })

  it('does not match once the tag is followed by a space', () => {
    expect(query('#idea ')).toBeNull()
  })

  it('consumes the rest of the tag word and one space after the caret', () => {
    expect(TAG_COMPLETION_CONSUME_AFTER.exec('ão rest')?.[0]).toBe('ão ')
    expect(TAG_COMPLETION_CONSUME_AFTER.exec(' rest')?.[0]).toBe(' ')
    expect(TAG_COMPLETION_CONSUME_AFTER.exec('.')?.[0]).toBe('')
  })
})

describe('tags: rankTagCompletions', () => {
  const tags: TagCount[] = [
    { tag: 'project', count: 3 },
    { tag: 'project/alpha', count: 1 },
    { tag: 'idea', count: 5 },
    { tag: 'reading', count: 2 },
    { tag: 'Pro', count: 1 },
    { tag: 'reunião', count: 1 },
    { tag: 'archive/idea', count: 9 }
  ]

  it('lists prefix matches first, then inner matches, each by count then name', () => {
    expect(rankTagCompletions(tags, 'pro').map((t) => t.tag)).toEqual(['project', 'Pro', 'project/alpha'])
    expect(rankTagCompletions(tags, 'idea').map((t) => t.tag)).toEqual(['idea', 'archive/idea'])
    expect(rankTagCompletions(tags, 'a').map((t) => t.tag)).toEqual(['archive/idea', 'idea', 'reading', 'project/alpha'])
  })

  it('matches case-insensitively and honours the limit', () => {
    expect(rankTagCompletions(tags, 'REUN').map((t) => t.tag)).toEqual(['reunião'])
    expect(rankTagCompletions(tags, 'e', 2)).toHaveLength(2)
  })

  it('returns nothing for an unknown prefix', () => {
    expect(rankTagCompletions(tags, 'zzz')).toEqual([])
  })
})
