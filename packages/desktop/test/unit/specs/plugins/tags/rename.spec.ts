import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseNote } from 'common/markdownExt'
import {
  parseTagInput,
  renameFrontMatterTags,
  renameTagInMarkdown,
  renameTagName
} from '@plugins/tags/common/rename'

const VAULT = resolve(__dirname, '../../../../fixtures/vault')
const fixture = (name: string): string => readFileSync(resolve(VAULT, name), 'utf-8')

describe('tags: parseTagInput', () => {
  it('accepts tags with or without `#` and a trailing slash', () => {
    expect(parseTagInput('#idea')).toBe('idea')
    expect(parseTagInput(' idea/product/ ')).toBe('idea/product')
    expect(parseTagInput('reunião')).toBe('reunião')
  })

  it('rejects non-tags and colours', () => {
    expect(parseTagInput('')).toBeNull()
    expect(parseTagInput('#')).toBeNull()
    expect(parseTagInput('2026')).toBeNull()
    expect(parseTagInput('two words')).toBeNull()
    expect(parseTagInput('#fff')).toBeNull()
    expect(parseTagInput('a//b')).toBeNull()
  })
})

describe('tags: renameTagName', () => {
  it('renames the tag and its nested tags case-insensitively', () => {
    expect(renameTagName('idea', 'idea', 'thought')).toBe('thought')
    expect(renameTagName('Idea/Research', 'idea', 'Thought')).toBe('Thought/Research')
    expect(renameTagName('IDEA', 'idea', 'Idea')).toBe('Idea')
  })

  it('leaves other tags alone', () => {
    expect(renameTagName('ideas', 'idea', 'x')).toBeNull()
    expect(renameTagName('my/idea', 'idea', 'x')).toBeNull()
    expect(renameTagName('ide', 'idea', 'x')).toBeNull()
  })
})

describe('tags: renameTagInMarkdown body', () => {
  it('renames exact and nested tags, keeping the new casing and longer tags intact', () => {
    const result = renameTagInMarkdown('Text #old, #old/sub and #older and (#OLD).\n', 'old', 'New')
    expect(result).toEqual({ content: 'Text #New, #New/sub and #older and (#New).\n', count: 3 })
  })

  it('keeps the casing of the nested part', () => {
    expect(renameTagInMarkdown('#Old/Sub/Leaf\n', 'old', 'new').content).toBe('#new/Sub/Leaf\n')
  })

  it('renames a parent into a nested tag', () => {
    expect(renameTagInMarkdown('#a and #a/b\n', 'a', 'x/a').content).toBe('#x/a and #x/a/b\n')
  })

  it('never touches code, math, links, URLs, HTML, escapes or comments', () => {
    const markdown = [
      'Inline `#old` and $#old$ and https://example.com/#old',
      '[#old](Notes.md) and [[Note#old]] and <span title="#old">x</span> and \\#old',
      '<!-- #old --> %% #old %%',
      '',
      '```',
      '#old in a fence',
      '```',
      '',
      '    #old indented code',
      '',
      'Real #old',
      ''
    ].join('\n')
    const result = renameTagInMarkdown(markdown, 'old', 'new')
    expect(result.count).toBe(1)
    expect(result.content).toBe(markdown.replace('Real #old', 'Real #new'))
  })

  it('returns the input unchanged when nothing matches', () => {
    const markdown = 'No #other tags `#old`\n'
    expect(renameTagInMarkdown(markdown, 'old', 'new')).toEqual({ content: markdown, count: 0 })
  })

  it('keeps CRLF line endings', () => {
    const result = renameTagInMarkdown('---\r\ntags: [old]\r\n---\r\n\r\nLine #old\r\nNext\r\n', 'old', 'new')
    expect(result).toEqual({ content: '---\r\ntags: [new]\r\n---\r\n\r\nLine #new\r\nNext\r\n', count: 2 })
  })
})

describe('tags: renameTagInMarkdown front matter', () => {
  it('rewrites a block list in place, keeping comments and other keys byte-identical', () => {
    const markdown = [
      '---',
      'title:   Plan   # keep this comment',
      'tags:',
      '  - old',
      '  - old/sub   # nested',
      '  - other',
      'aliases: [ A,   B ]',
      '---',
      '',
      'Body',
      ''
    ].join('\n')
    const result = renameTagInMarkdown(markdown, 'old', 'new')
    expect(result.count).toBe(2)
    expect(result.content).toBe(markdown.replace('  - old\n', '  - new\n').replace('- old/sub', '- new/sub'))
  })

  it('rewrites inline arrays with plain and quoted items', () => {
    const markdown = '---\ntags: [old, "#old/x", \'Old\', keep]\n---\n\nBody\n'
    expect(renameTagInMarkdown(markdown, 'old', 'new')).toEqual({
      content: '---\ntags: [new, "#new/x", \'new\', keep]\n---\n\nBody\n',
      count: 3
    })
  })

  it('rewrites tags inside a comma or space separated string', () => {
    const markdown = '---\ntags: old, other old/sub\ntag: "#old"\n---\n\nBody\n'
    expect(renameTagInMarkdown(markdown, 'old', 'new')).toEqual({
      content: '---\ntags: new, other new/sub\ntag: "#new"\n---\n\nBody\n',
      count: 3
    })
  })

  it('matches the tags key case-insensitively and ignores other keys', () => {
    const markdown = '---\nTags: [old]\ntitle: old\nkeywords: [old]\n---\n\nBody\n'
    expect(renameTagInMarkdown(markdown, 'old', 'new').content).toBe(
      '---\nTags: [new]\ntitle: old\nkeywords: [old]\n---\n\nBody\n'
    )
  })

  it('quotes a new name YAML would read as another type', () => {
    expect(renameFrontMatterTags('tags: [old, keep]\n', 'old', 'null')).toEqual({
      yaml: 'tags: ["null", keep]\n',
      count: 1
    })
    expect(renameFrontMatterTags('tags:\n  - old\n', 'old', '1e3')).toEqual({ yaml: 'tags:\n  - "1e3"\n', count: 1 })
  })

  it('re-serializes only when a block scalar holds the tags', () => {
    const result = renameFrontMatterTags('tags: >\n  old other\n', 'old', 'new')
    expect(result.count).toBe(1)
    expect(parseNote(`---\n${result.yaml}---\n`).tags).toEqual(['new', 'other'])
  })

  it('leaves invalid YAML alone but still renames body tags', () => {
    const markdown = '---\ntags: [old\n---\n\nBody #old\n'
    expect(renameTagInMarkdown(markdown, 'old', 'new')).toEqual({
      content: '---\ntags: [old\n---\n\nBody #new\n',
      count: 1
    })
  })
})

describe('tags: renaming fixture notes', () => {
  it('Ideas.md: string front matter and body tags, any case', () => {
    const result = renameTagInMarkdown(fixture('Ideas.md'), 'idea', 'Thought')
    expect(result.count).toBe(4)
    expect(result.content).toContain('tags: Thought, Thought/product\n')
    expect(result.content).toContain('names #Thought/research and #Thought in another case. ^idea-1')
    // Words that merely contain the tag name are untouched.
    expect(result.content).toContain('- First idea about [[Projects/Alpha]]')
    expect(parseNote(result.content).tags).toEqual(['Thought', 'Thought/product', 'Thought/research'])
  })

  it('Projects/Alpha.md: block list and a task tag; other front matter untouched', () => {
    const original = fixture('Projects/Alpha.md')
    const result = renameTagInMarkdown(original, 'project', 'work')
    expect(result.count).toBe(3)
    expect(result.content).toBe(
      original
        .replace('  - project\n  - project/alpha\n', '  - work\n  - work/alpha\n')
        .replace('[due:: 2026-10-05] #project/alpha', '[due:: 2026-10-05] #work/alpha')
    )
  })

  it('Tags Edge Cases.md: only real tags change', () => {
    const original = fixture('Tags Edge Cases.md')
    const result = renameTagInMarkdown(original, 'fenced', 'x')
    expect(result.count).toBe(0)
    expect(renameTagInMarkdown(original, 'code', 'x').count).toBe(0)
    expect(renameTagInMarkdown(original, 'label', 'x').count).toBe(0)
    expect(renameTagInMarkdown(original, 'reunião', 'encontro').content).toBe(
      original.replace('Valid: #reunião', 'Valid: #encontro')
    )
  })
})
