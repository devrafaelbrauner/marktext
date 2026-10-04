import { describe, expect, it } from 'vitest'
import { linkMentionInText } from '@plugins/links/common/linkMention'
import { findMentions } from '@plugins/links/common/mentions'

describe('unlinked mentions', () => {
  it('matches whole words case-insensitively', () => {
    const found = findMentions('Alpha ships. alpha-team, Alphabet, the ALPHA.\nnoalpha', ['Alpha'])
    expect(found.map((m) => [m.text, m.line, m.column])).toEqual([
      ['Alpha', 0, 0],
      ['alpha', 0, 13],
      ['ALPHA', 0, 39]
    ])
    expect(found[0].context).toBe('Alpha ships. alpha-team, Alphabet, the ALPHA.')
  })

  it('treats accented letters as word characters', () => {
    expect(findMentions('Alphaé Alpha', ['Alpha']).map((m) => m.start)).toEqual([7])
  })

  it('skips links, code, math, html and front matter', () => {
    const md = [
      '---',
      'title: Alpha',
      '---',
      '',
      '[[Alpha]] [Alpha](Alpha.md) `Alpha` $Alpha$ <span title="Alpha">x</span>',
      '',
      '```',
      'Alpha',
      '```',
      'real Alpha here'
    ].join('\n')
    expect(findMentions(md, ['Alpha']).map((m) => [m.line, m.column])).toEqual([[9, 5]])
  })

  it('prefers the longest of overlapping terms and honours the limit', () => {
    const found = findMentions('Project Alpha and Alpha', ['Alpha', 'Project Alpha'])
    expect(found.map((m) => m.text)).toEqual(['Project Alpha', 'Alpha'])
    expect(findMentions('a a a a', ['a'], 2)).toHaveLength(2)
    expect(findMentions('text', ['', '  '])).toEqual([])
  })

  it('links a mention, keeping its wording through an alias', () => {
    const md = 'x\r\nsee alpha now\r\n'
    const [mention] = findMentions(md, ['Alpha'])
    expect(linkMentionInText(md, mention, 'Alpha')).toBe('x\r\nsee [[Alpha|alpha]] now\r\n')
    const exact = findMentions('see Alpha', ['Alpha'])[0]
    expect(linkMentionInText('see Alpha', exact, 'Alpha')).toBe('see [[Alpha]]')
    expect(linkMentionInText('see Alpha', exact, 'Projects/Alpha')).toBe('see [[Projects/Alpha|Alpha]]')
    expect(linkMentionInText('see Beta!', exact, 'Alpha')).toBeNull()
  })
})
