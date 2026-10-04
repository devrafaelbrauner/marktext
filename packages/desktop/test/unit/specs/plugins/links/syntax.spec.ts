import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MarkdownToHtml, registerInlineSyntax } from '@muyajs/core'
import { exportWikilinkHtml, matchWikilinkToken, wikilinkDisplayText, wikilinkHref } from '@plugins/links/common/syntax'

const visible = (src: string): string | null => {
  const match = matchWikilinkToken(src, '')
  return match ? src.slice(match.contentStart, match.contentEnd) : null
}

describe('wikilink token', () => {
  it('shows the alias, or the target with its heading', () => {
    expect(visible('[[note]] rest')).toBe('note')
    expect(visible('[[note|alias]]')).toBe('alias')
    expect(visible('[[note#Heading]]')).toBe('note#Heading')
    expect(visible('[[note#^block]]')).toBe('note#^block')
    expect(visible('![[doc.pdf#page=3]]')).toBe('doc.pdf#page=3')
    expect(matchWikilinkToken('![[x]]', '')).toMatchObject({ length: 6, contentStart: 3, contentEnd: 4 })
  })

  it('exposes the parsed parts as data', () => {
    expect(matchWikilinkToken('[[Folder/Note#Sec|Shown]]', '')!.data).toEqual({ target: 'Folder/Note', heading: 'Sec', alias: 'Shown' })
    expect(matchWikilinkToken('[[note#^b1]]', '')!.data).toEqual({ target: 'note', blockId: 'b1' })
    expect(matchWikilinkToken('![[doc.pdf#page=3]]', '')!.data).toEqual({ target: 'doc.pdf', subpath: 'page=3', embed: 'true' })
  })

  it('accepts the escaped table pipe as alias separator', () => {
    const match = matchWikilinkToken('[[Note\\|Alias]] |', '')!
    expect(match.data).toEqual({ target: 'Note', alias: 'Alias' })
    expect('[[Note\\|Alias]]'.slice(match.contentStart, match.contentEnd)).toBe('Alias')
  })

  it('rejects nested brackets, empty links and escaped openers', () => {
    expect(matchWikilinkToken('[[a [b] c]]', '')).toBeNull()
    expect(matchWikilinkToken('[[]]', '')).toBeNull()
    expect(matchWikilinkToken('[[|x]]', '')).toBeNull()
    expect(matchWikilinkToken('[[note]]', '\\')).toBeNull()
    expect(matchWikilinkToken('[[a\nb]]', '')).toBeNull()
    // `[[[x]]` starts with an unmatched `[`; the link begins one character later.
    expect(matchWikilinkToken('[[[x]]', '')).toBeNull()
    expect(matchWikilinkToken('[[x]]', '[')).not.toBeNull()
  })

  it('computes display text and relative hrefs', () => {
    expect(wikilinkDisplayText({ target: 'Note', heading: 'Sec' })).toBe('Note#Sec')
    expect(wikilinkDisplayText({ target: 'Note', alias: 'A' })).toBe('A')
    expect(wikilinkDisplayText({ target: '', heading: 'Local' })).toBe('Local')
    expect(wikilinkHref({ target: 'Reading List' })).toBe('Reading%20List.md')
    expect(wikilinkHref({ target: 'Projects/Alpha', heading: 'Goals' })).toBe('Projects/Alpha.md#Goals')
    expect(wikilinkHref({ target: 'Ideas', blockId: 'idea-1' })).toBe('Ideas.md#%5Eidea-1')
    expect(wikilinkHref({ target: 'sample.pdf', subpath: 'page=2' })).toBe('sample.pdf#page%3D2')
    expect(wikilinkHref({ target: '', heading: 'Top' })).toBe('#Top')
  })

  it('escapes exported html', () => {
    expect(exportWikilinkHtml({ target: 'a"b', alias: '<script>' })).toBe('<a href="a%22b.md">&lt;script&gt;</a>')
  })
})

describe('wikilink rule inside the engine', () => {
  let dispose: () => void
  beforeAll(() => {
    dispose = registerInlineSyntax({
      name: 'wikilink',
      precedence: 'beforeEmphasis',
      match: matchWikilinkToken,
      exportHtml: (_raw, data) => exportWikilinkHtml(data)
    })
  })
  afterAll(() => dispose())

  const render = (markdown: string): Promise<string> => new MarkdownToHtml(markdown).renderHtml()

  it('keeps underscores in targets out of emphasis', async() => {
    const html = await render('see [[x_y_z]] and [[a_b|c_d]] _e_\n')
    expect(html).toContain('<a href="a_b.md">c_d</a>')
    expect(html).toContain('<a href="x_y_z.md">x_y_z</a>')
    expect(html.match(/<em>/g)).toHaveLength(1)
  })

  it('exports aliases and headings, and leaves escaped and code links alone', async() => {
    const html = await render('[[Projects/Alpha|Project Alpha]] and [[Ideas#Backlog]] and `[[code]]` and \\[[esc]]\n')
    expect(html).toContain('<a href="Projects/Alpha.md">Project Alpha</a>')
    expect(html).toContain('<a href="Ideas.md#Backlog">Ideas#Backlog</a>')
    expect(html).toContain('<code>[[code]]</code>')
    expect(html).not.toContain('esc.md')
  })

  it('exports aliased links inside table cells', async() => {
    const html = await render('| a | b |\n| --- | --- |\n| [[Note\\|Shown]] | x |\n')
    expect(html).toContain('<a href="Note.md">Shown</a>')
  })
})
