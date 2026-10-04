import { describe, expect, it } from 'vitest'
import { MARKDOWN_EXTENSIONS } from 'common/filesystem/paths'
import {
  MARKDOWN_FILE_EXTENSIONS,
  countWords,
  createLinkResolver,
  getDailyNoteDate,
  getFrontMatterAliases,
  getFrontMatterTags,
  matchTag,
  matchWikilink,
  normalizeTag,
  parseFrontMatter,
  parseInlineFieldValue,
  parseLinkDestination,
  parseNote,
  parseWikilink,
  resolveLinkTarget
} from 'common/markdownExt'

const tagsOf = (markdown: string): string[] => parseNote(markdown).tags
const linksOf = (markdown: string) => parseNote(markdown).links

describe('markdownExt: extension list', () => {
  it('mirrors the desktop markdown extension list', () => {
    expect([...MARKDOWN_FILE_EXTENSIONS].sort()).toEqual([...MARKDOWN_EXTENSIONS].sort())
  })
})

describe('markdownExt: wikilinks', () => {
  it('splits target, heading, block id and alias', () => {
    expect(parseWikilink('[[Folder/Note#Heading^blk-1|Shown]]')).toEqual({
      target: 'Folder/Note',
      heading: 'Heading',
      blockId: 'blk-1',
      alias: 'Shown',
      embed: false
    })
    expect(parseWikilink('[[Note#^abc]]')).toEqual({ target: 'Note', blockId: 'abc', embed: false })
    expect(parseWikilink('[[#Local heading]]')).toEqual({ target: '', heading: 'Local heading', embed: false })
  })

  it('marks embeds', () => {
    expect(parseWikilink('![[Diagram.png]]')).toEqual({ target: 'Diagram.png', embed: true })
  })

  it('keeps the part after # as an opaque subpath for non-markdown targets', () => {
    expect(parseWikilink('[[doc.pdf#page=3|Page three]]')).toEqual({
      target: 'doc.pdf',
      subpath: 'page=3',
      alias: 'Page three',
      embed: false
    })
    // Markdown extensions still mean headings.
    expect(parseWikilink('[[Note.md#Intro]]')).toEqual({ target: 'Note.md', heading: 'Intro', embed: false })
  })

  it('accepts the table-escaped alias separator', () => {
    expect(parseWikilink('[[Note\\|Alias]]')).toEqual({ target: 'Note', alias: 'Alias', embed: false })
  })

  it('rejects links without target, heading or block', () => {
    expect(parseWikilink('[[]]')).toBeNull()
    expect(parseWikilink('[[|alias]]')).toBeNull()
    expect(parseWikilink('[[a]] tail')).toBeNull()
  })

  it('matches only at the start of the source for inline lexers', () => {
    expect(matchWikilink('[[A|b]] rest')).toEqual({ raw: '[[A|b]]', link: { target: 'A', alias: 'b', embed: false } })
    expect(matchWikilink('x [[A]]')).toBeNull()
    expect(matchWikilink('[[multi\nline]]')).toBeNull()
  })

  it('reports 0-based line and UTF-16 column of each link', () => {
    const [first, second] = linksOf('first line\n😀 see [[A]] and ![[B]]')
    expect(first).toMatchObject({ target: 'A', line: 1, column: 7, kind: 'wikilink', embed: false })
    expect(second).toMatchObject({ target: 'B', line: 1, column: 17, embed: true })
  })

  it('ignores links in code, math, comments and escaped brackets', () => {
    const markdown = [
      '`[[span]]` $[[math]]$ \\[[escaped]] <!-- [[html]] --> %% [[obsidian]] %%',
      '',
      '```',
      '[[fenced]]',
      '```',
      '',
      '    [[indented]]',
      '',
      '[[real]]'
    ].join('\n')
    expect(linksOf(markdown).map((link) => link.target)).toEqual(['real'])
  })

  it('keeps links in indented list continuation lines', () => {
    const markdown = '- item\n\n    continued [[Kept]]\n'
    expect(linksOf(markdown).map((link) => link.target)).toEqual(['Kept'])
  })
})

describe('markdownExt: markdown links', () => {
  it('decodes relative targets and splits the fragment', () => {
    expect(parseLinkDestination('../Notes/My%20Note.md#Some%20Heading')).toEqual({
      target: '../Notes/My Note.md',
      heading: 'Some Heading'
    })
    expect(parseLinkDestination('<docs/a b.pdf#page=2>')).toEqual({ target: 'docs/a b.pdf', subpath: 'page=2' })
    expect(parseLinkDestination('note.md#^blk')).toEqual({ target: 'note.md', blockId: 'blk' })
  })

  it('skips URLs, protocol-relative links and same-document anchors', () => {
    expect(parseLinkDestination('https://example.com/a.md')).toBeNull()
    expect(parseLinkDestination('mailto:me@example.com')).toBeNull()
    expect(parseLinkDestination('//cdn.example.com/x.png')).toBeNull()
    expect(parseLinkDestination('#heading')).toBeNull()
  })

  it('finds links, images, titles and images nested in link text', () => {
    const links = linksOf('[A](a.md "Title") ![img](pics/i.png) [![inner](x.png)](y.md) [web](https://x.y) [ref][1]')
    expect(links.map((link) => [link.target, link.embed, link.kind])).toEqual([
      ['a.md', false, 'markdown'],
      ['pics/i.png', true, 'markdown'],
      ['y.md', false, 'markdown'],
      ['x.png', true, 'markdown']
    ])
  })

  it('keeps balanced parentheses in destinations', () => {
    expect(linksOf('[x](Notes/Plan%20(v2).md)')[0]).toMatchObject({ target: 'Notes/Plan (v2).md' })
  })
})

describe('markdownExt: tags', () => {
  it('accepts Unicode letters, nesting, underscores and dashes', () => {
    expect(tagsOf('#reunião #a/b #snake_case #kebab-case #日本語')).toEqual([
      'reunião',
      'a/b',
      'snake_case',
      'kebab-case',
      '日本語'
    ])
  })

  it('requires start, whitespace or punctuation before #', () => {
    expect(tagsOf('(#paren) "#quoted" end.#dot C#sharp a#b')).toEqual(['paren', 'quoted', 'dot'])
  })

  it('rejects headings, digits-only tags and hex colours, but keeps hex-like words', () => {
    expect(tagsOf('# Heading\n\n#2026 #2026-10 #fff #1e1e1e #FFAA00 #a1b #cafe #bad #y2026')).toEqual([
      'cafe',
      'bad',
      'y2026'
    ])
  })

  it('ignores tags in code, math, URLs, links, wikilinks and HTML', () => {
    const markdown = [
      '`#code` $#math$ https://example.com/#anchor www.example.com/#x',
      '[#label](note.md) [[Note#heading]] <span title="#attr">#inside</span> &#35;',
      '',
      '~~~',
      '#fenced',
      '~~~',
      '#real'
    ].join('\n')
    expect(tagsOf(markdown)).toEqual(['inside', 'real'])
  })

  it('ignores escaped hashes and strips trailing slashes', () => {
    expect(tagsOf('\\#escaped #parent/ ok')).toEqual(['parent'])
  })

  it('de-duplicates case-insensitively keeping the first spelling, front matter first', () => {
    expect(tagsOf('---\ntags: [Work]\n---\n\n#work #Idea #IDEA\n')).toEqual(['Work', 'Idea'])
  })

  it('exposes lexer helpers with the same rules', () => {
    expect(matchTag('#tag/sub rest', ' ')).toEqual({ raw: '#tag/sub', tag: 'tag/sub' })
    expect(matchTag('#tag', 'a')).toBeNull()
    expect(matchTag('#abc', undefined)).toEqual({ raw: '#abc', tag: 'abc' })
    expect(matchTag('#123', undefined)).toBeNull()
    expect(normalizeTag('#x/')).toBe('x')
    expect(normalizeTag('/x')).toBeNull()
    expect(normalizeTag('two words')).toBeNull()
  })
})

describe('markdownExt: front matter', () => {
  it('follows muya: --- at the very start, closed by --- then a blank line or EOF', () => {
    expect(parseFrontMatter('---\ntitle: A\n---\n\nbody')).toEqual({ title: 'A' })
    expect(parseFrontMatter('---\ntitle: A\n---\n')).toEqual({ title: 'A' })
    expect(parseFrontMatter('---\ntitle: A\n---\nbody')).toBeNull()
    expect(parseFrontMatter('\n---\ntitle: A\n---\n\n')).toBeNull()
  })

  it('normalizes CRLF before detection', () => {
    expect(parseNote('---\r\ntags: x\r\n---\r\n\r\n#y\r\n').tags).toEqual(['x', 'y'])
  })

  it('returns null for invalid YAML, duplicate keys and non-mappings without throwing', () => {
    expect(parseFrontMatter('---\nkey: [unclosed\n---\n\n')).toBeNull()
    expect(parseFrontMatter('---\na: 1\na: 2\n---\n\n')).toBeNull()
    expect(parseFrontMatter('---\n- just\n- a list\n---\n\n')).toBeNull()
  })

  it('keeps ISO dates as strings', () => {
    expect(parseFrontMatter('---\ndate: 2026-10-04\n---\n\n')).toEqual({ date: '2026-10-04' })
  })

  it('reads tags/tag and aliases/alias as lists or separated strings', () => {
    expect(getFrontMatterTags({ tags: ['a', '#b', 'c/d'], tag: 'e, f g' })).toEqual(['a', 'b', 'c/d', 'e', 'f', 'g'])
    expect(getFrontMatterTags({ Tags: 2026 })).toEqual([])
    expect(getFrontMatterAliases({ aliases: 'One, Two words', alias: ['Three', 'One'] })).toEqual([
      'One',
      'Two words',
      'Three'
    ])
    expect(getFrontMatterAliases(null)).toEqual([])
  })

  it('excludes front matter from body tags, links, fields and word count', () => {
    const note = parseNote('---\nnote: "#nottag [[NotLink]] key:: v"\n---\n\none two\n')
    expect(note.tags).toEqual([])
    expect(note.links).toEqual([])
    expect(note.fields).toEqual({})
    expect(note.wordCount).toBe(2)
  })
})

describe('markdownExt: inline fields', () => {
  it('types values: numbers, booleans, empty, dates and links stay strings', () => {
    expect(parseInlineFieldValue(' 42 ')).toBe(42)
    expect(parseInlineFieldValue('-1.5')).toBe(-1.5)
    expect(parseInlineFieldValue('TRUE')).toBe(true)
    expect(parseInlineFieldValue('false')).toBe(false)
    expect(parseInlineFieldValue('')).toBeNull()
    expect(parseInlineFieldValue('2026-10-04')).toBe('2026-10-04')
    expect(parseInlineFieldValue('[[Note]]')).toBe('[[Note]]')
    expect(parseInlineFieldValue('1,000')).toBe('1,000')
  })

  it('reads line, bracket and parenthesis fields with lower-cased keys', () => {
    const note = parseNote(
      [
        'Status:: Active',
        '**Owner**:: [[Home]]',
        '- list item:: 3',
        '> quoted:: yes',
        'Text with [Due:: 2026-10-04] and (Hidden Key:: [[A]] and [[B]]) here.'
      ].join('\n')
    )
    expect(note.fields).toEqual({
      status: 'Active',
      owner: '[[Home]]',
      'list item': 3,
      quoted: 'yes',
      due: '2026-10-04',
      'hidden key': '[[A]] and [[B]]'
    })
  })

  it('collects repeated keys into arrays in document order', () => {
    expect(parseNote('mood:: good\nmood:: tired\nmood:: 3').fields).toEqual({ mood: ['good', 'tired', 3] })
  })

  it('ignores fields in code, wikilinks and unclosed brackets', () => {
    expect(parseNote('`a:: b`\n\n```\nc:: d\n```\n[[x::y]] [open:: never closed\n').fields).toEqual({})
  })

  it('cannot reach the prototype through a field key', () => {
    const { fields } = parseNote('__proto__:: polluted\n[constructor:: x]')
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype)
    expect(fields).toEqual({ proto: 'polluted', constructor: 'x' })
  })
})

describe('markdownExt: tasks', () => {
  it('reads bullet and ordered tasks with any status character', () => {
    const { tasks } = parseNote(
      ['- [ ] open', '* [x] done', '+ [X] Done', '- [-] cancelled', '1. [/] half', '2) [>] later', '- [ ]', '> - [ ] quoted'].join('\n')
    )
    expect(tasks.map((task) => [task.status, task.checked, task.text, task.line])).toEqual([
      [' ', false, 'open', 0],
      ['x', true, 'done', 1],
      ['X', true, 'Done', 2],
      ['-', true, 'cancelled', 3],
      ['/', true, 'half', 4],
      ['>', true, 'later', 5],
      [' ', false, '', 6],
      [' ', false, 'quoted', 7]
    ])
  })

  it('is not fooled by links, plain lists or code', () => {
    const { tasks } = parseNote('- [[Link]]\n- [link](x.md)\n- plain\n-[ ] no space\n\n```\n- [ ] code\n```\n')
    expect(tasks).toEqual([])
  })

  it('attaches the fields of the task line to the task and the file', () => {
    const note = parseNote('- [ ] Pay rent [due:: 2026-10-05] (amount:: 900) #home\n- [x] due:: 2026-09-01\n')
    expect(note.tasks[0].fields).toEqual({ due: '2026-10-05', amount: 900 })
    expect(note.tasks[1].fields).toEqual({ due: '2026-09-01' })
    expect(note.fields).toEqual({ due: ['2026-10-05', '2026-09-01'], amount: 900 })
  })
})

describe('markdownExt: headings', () => {
  it('reads ATX and setext headings as plain text', () => {
    const { headings } = parseNote(
      [
        '# **Bold** and `code` [[Target|alias]] [link](x.md) ##',
        '',
        'Multi line',
        'setext',
        '=====',
        '',
        'Second',
        '---',
        '',
        '#not-heading',
        '',
        '```',
        '# in code',
        '```',
        '###### Six \\*'
      ].join('\n')
    )
    expect(headings).toEqual([
      { level: 1, text: 'Bold and code alias link', line: 0 },
      { level: 1, text: 'Multi line setext', line: 2 },
      { level: 2, text: 'Second', line: 6 },
      { level: 6, text: 'Six *', line: 14 }
    ])
  })

  it('treats --- after a list or blank line as a thematic break, not a heading', () => {
    expect(parseNote('- item\n---\n\ntext\n\n---\n').headings).toEqual([])
  })
})

describe('markdownExt: word count and daily notes', () => {
  it('counts words like muya (each CJK ideograph is a word)', () => {
    expect(countWords('one two  three\nfour')).toBe(4)
    expect(countWords('中文 test')).toBe(3)
    expect(countWords('')).toBe(0)
  })

  it('recognises valid YYYY-MM-DD basenames only', () => {
    expect(getDailyNoteDate('2026-10-04')).toBe('2026-10-04')
    expect(getDailyNoteDate('2026-02-30')).toBeNull()
    expect(getDailyNoteDate('2026-10-04 notes')).toBeNull()
    expect(getDailyNoteDate('20261004')).toBeNull()
  })
})

describe('markdownExt: link resolution', () => {
  const paths = [
    'Notes.md',
    'Archive/Notes.md',
    'Archive/2025/Notes.md',
    'Projects/Alpha.md',
    'Projects/Sub/Alpha.md',
    'Zeta/Alpha.md',
    'Attachments/sample.pdf',
    'Docs/sample.pdf',
    'Readme'
  ]
  const resolver = createLinkResolver(paths)

  it('prefers the exact vault path, with or without .md', () => {
    expect(resolver.resolve('Archive/Notes', 'Home.md')).toBe('Archive/Notes.md')
    expect(resolver.resolve('Archive/Notes.md', 'Home.md')).toBe('Archive/Notes.md')
    expect(resolver.resolve('/Archive/2025/Notes', 'Home.md')).toBe('Archive/2025/Notes.md')
  })

  it('falls back to a case-insensitive name match on the shortest path', () => {
    expect(resolver.resolve('notes', 'Projects/Alpha.md')).toBe('Notes.md')
    // Shortest path first, whatever the alphabetical order.
    expect(resolver.resolve('ALPHA', 'Home.md')).toBe('Zeta/Alpha.md')
  })

  it('matches trailing segments when the target contains a folder', () => {
    expect(resolver.resolve('Sub/Alpha', 'Home.md')).toBe('Projects/Sub/Alpha.md')
    expect(resolver.resolve('Missing/Alpha', 'Home.md')).toBeNull()
  })

  it('resolves non-markdown targets by exact file name', () => {
    expect(resolver.resolve('sample.pdf', 'Home.md')).toBe('Docs/sample.pdf')
    expect(resolver.resolve('Attachments/sample.pdf', 'Home.md')).toBe('Attachments/sample.pdf')
    expect(resolver.resolve('sample', 'Home.md')).toBeNull()
    expect(resolver.resolve('Readme', 'Home.md')).toBe('Readme')
  })

  it('resolves paths relative to the source note', () => {
    expect(resolver.resolve('./Alpha', 'Projects/Sub/Alpha.md')).toBe('Projects/Sub/Alpha.md')
    expect(resolver.resolve('../Notes.md', 'Archive/2025/x.md')).toBe('Archive/Notes.md')
    expect(resolver.resolve('../../../Notes.md', 'Archive/x.md')).toBeNull()
    // Markdown links prefer the relative reading; wikilinks the vault path.
    expect(resolver.resolve('Notes.md', 'Archive/x.md', { preferRelative: true })).toBe('Archive/Notes.md')
    expect(resolver.resolve('Notes.md', 'Archive/x.md')).toBe('Notes.md')
  })

  it('resolves an empty target to the source note and unknown targets to null', () => {
    expect(resolver.resolve('', 'Notes.md')).toBe('Notes.md')
    expect(resolver.resolve('Nowhere', 'Notes.md')).toBeNull()
  })

  it('offers a one-off helper with the same semantics', () => {
    expect(resolveLinkTarget('Notes', 'x.md', paths)).toBe('Notes.md')
  })
})
