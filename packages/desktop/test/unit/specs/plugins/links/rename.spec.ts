import { describe, expect, it } from 'vitest'
import { planRenameRewrites, type NoteSource } from '@plugins/links/common/rename'

const rewrite = (rename: { oldPath: string; newPath: string }, paths: string[], notes: NoteSource[]) =>
  Object.fromEntries(planRenameRewrites(rename, paths, notes).map((r) => [r.path, r.content]))

describe('rename link rewrite', () => {
  const after = ['Home.md', 'Projects/Gamma.md', 'Projects/Alpha.md', 'Notes.md']
  const rename = { oldPath: 'Projects/Beta.md', newPath: 'Projects/Gamma.md' }

  it('rewrites wikilinks keeping alias, heading, block id and embeds', () => {
    const home = [
      '- [[Beta]] and [[Beta|the beta]] and [[Beta#Plan]] and [[Beta#^b1|x]]',
      '- ![[Beta]] and [[Projects/Beta]] and [[beta.md]]',
      '- [[Notes]] stays, [[Missing]] stays'
    ].join('\n')
    expect(rewrite(rename, after, [{ path: 'Home.md', content: home }])).toEqual({
      'Home.md': [
        '- [[Gamma]] and [[Gamma|the beta]] and [[Gamma#Plan]] and [[Gamma#^b1|x]]',
        '- ![[Gamma]] and [[Projects/Gamma]] and [[Gamma.md]]',
        '- [[Notes]] stays, [[Missing]] stays'
      ].join('\n')
    })
  })

  it('rewrites the escaped table pipe form', () => {
    const content = '| a |\n| --- |\n| [[Beta\\|B]] |\n'
    expect(rewrite(rename, after, [{ path: 'Home.md', content }])['Home.md']).toBe('| a |\n| --- |\n| [[Gamma\\|B]] |\n')
  })

  it('rewrites relative markdown links and keeps fragments and encoding', () => {
    const content = 'See [b](Projects/Beta.md#plan "t") and [c](<Projects/Beta.md>) and [x](https://e.com/Beta.md)\n'
    expect(rewrite(rename, after, [{ path: 'Home.md', content }])['Home.md']).toBe(
      'See [b](Projects/Gamma.md#plan "t") and [c](<Projects/Gamma.md>) and [x](https://e.com/Beta.md)\n'
    )
  })

  it('does not touch code spans, code blocks or front matter', () => {
    const content = '---\nup: "[[Beta]]"\n---\n\n`[[Beta]]` and [[Beta]]\n\n```\n[[Beta]] [b](Projects/Beta.md)\n```\n\n    [[Beta]]\n'
    expect(rewrite(rename, after, [{ path: 'Home.md', content }])['Home.md']).toBe(
      '---\nup: "[[Beta]]"\n---\n\n`[[Beta]]` and [[Gamma]]\n\n```\n[[Beta]] [b](Projects/Beta.md)\n```\n\n    [[Beta]]\n'
    )
  })

  it('keeps the shortest-unique style when the new name is ambiguous', () => {
    const paths = ['Home.md', 'Notes.md', 'Archive/Notes.md']
    const result = rewrite({ oldPath: 'Archive/Old.md', newPath: 'Archive/Notes.md' }, paths, [
      { path: 'Home.md', content: '[[Old]] and [[Notes]]\n' }
    ])
    expect(result['Home.md']).toBe('[[Archive/Notes]] and [[Notes]]\n')
  })

  it('follows a folder move, including relative links of the moved notes', () => {
    const paths = ['Home.md', 'Work/Alpha.md', 'Work/Beta.md', 'Notes.md']
    const result = rewrite({ oldPath: 'Projects', newPath: 'Work' }, paths, [
      { path: 'Home.md', content: '[[Projects/Alpha]] [[Beta]] [a](Projects/Alpha.md)\n' },
      { path: 'Work/Alpha.md', content: '[n](../Notes.md) [b](Beta.md) [[Notes]]\n' }
    ])
    expect(result).toEqual({ 'Home.md': '[[Work/Alpha]] [[Beta]] [a](Work/Alpha.md)\n' })
  })

  it('updates relative links of a note moved to another folder', () => {
    const paths = ['Home.md', 'Deep/Inner/Alpha.md', 'Reading List.md']
    const result = rewrite({ oldPath: 'Alpha.md', newPath: 'Deep/Inner/Alpha.md' }, paths, [
      { path: 'Deep/Inner/Alpha.md', content: 'Read [list](Reading%20List.md) and [h](./Home.md#top)\n' },
      { path: 'Home.md', content: '[a](Alpha.md) and [[Alpha]]\n' }
    ])
    expect(result).toEqual({
      'Deep/Inner/Alpha.md': 'Read [list](../../Reading%20List.md) and [h](../../Home.md#top)\n',
      'Home.md': '[a](Deep/Inner/Alpha.md) and [[Alpha]]\n'
    })
  })

  it('keeps CRLF line endings and leaves unrelated notes alone', () => {
    const result = rewrite(rename, after, [
      { path: 'Home.md', content: 'a\r\n[[Beta]]\r\n' },
      { path: 'Notes.md', content: 'nothing here [[Notes]]\n' }
    ])
    expect(result).toEqual({ 'Home.md': 'a\r\n[[Gamma]]\r\n' })
  })

  it('rewrites links to renamed attachments', () => {
    const paths = ['Home.md', 'Attachments/spec.pdf']
    const result = rewrite({ oldPath: 'Attachments/sample.pdf', newPath: 'Attachments/spec.pdf' }, paths, [
      { path: 'Home.md', content: '[[sample.pdf#page=2|the PDF]] ![[sample.pdf]] ![img](Attachments/sample.pdf)\n' }
    ])
    expect(result['Home.md']).toBe('[[spec.pdf#page=2|the PDF]] ![[spec.pdf]] ![img](Attachments/spec.pdf)\n')
  })
})
