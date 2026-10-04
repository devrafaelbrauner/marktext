import { describe, expect, it } from 'vitest'
import { createLinkResolver } from 'common/markdownExt'
import { matchRank, rankPaths } from '@plugins/links/common/completion'
import { linkTextFor, shortestLinkText } from '@plugins/links/common/linkText'
import { mapRenamedPath, relativePath, toAbsolutePath, toVaultPath } from '@plugins/links/common/paths'

const VAULT = [
  'Home.md',
  'Notes.md',
  'Archive/Notes.md',
  'Archive/2025/Notes.md',
  'Projects/Alpha.md',
  'Projects/Beta.md',
  'Projects/Kanban Board.md',
  'Reading List.md',
  'Attachments/sample.pdf',
  'Daily/2026-10-01.md'
]
const resolver = createLinkResolver(VAULT)

describe('link text', () => {
  it('uses the bare name when it is unique, the vault path otherwise', () => {
    expect(shortestLinkText('Projects/Alpha.md', 'Home.md', resolver)).toBe('Alpha')
    expect(shortestLinkText('Notes.md', 'Home.md', resolver)).toBe('Notes')
    expect(shortestLinkText('Archive/Notes.md', 'Home.md', resolver)).toBe('Archive/Notes')
    expect(shortestLinkText('Attachments/sample.pdf', 'Home.md', resolver)).toBe('sample.pdf')
  })

  it('honours the relative and absolute formats', () => {
    expect(linkTextFor('Projects/Beta.md', 'Projects/Alpha.md', resolver, 'relative')).toBe('Beta')
    expect(linkTextFor('Archive/Notes.md', 'Projects/Alpha.md', resolver, 'relative')).toBe('../Archive/Notes')
    expect(linkTextFor('Projects/Beta.md', 'Home.md', resolver, 'relative')).toBe('Projects/Beta')
    expect(linkTextFor('Projects/Beta.md', 'Home.md', resolver, 'absolute')).toBe('Projects/Beta')
    for (const format of ['shortest', 'relative', 'absolute'] as const) {
      for (const target of VAULT) {
        const text = linkTextFor(target, 'Projects/Alpha.md', resolver, format)
        expect(resolver.resolve(text, 'Projects/Alpha.md'), `${format} ${target}`).toBe(target)
      }
    }
  })
})

describe('completion ranking', () => {
  it('ranks prefix over word start over substring over path', () => {
    expect(matchRank('kan', 'Projects/Kanban Board.md')).toBe(0)
    expect(matchRank('board', 'Projects/Kanban Board.md')).toBe(1)
    expect(matchRank('anb', 'Projects/Kanban Board.md')).toBe(2)
    expect(matchRank('proj', 'Projects/Kanban Board.md')).toBe(3)
    expect(matchRank('zzz', 'Projects/Kanban Board.md')).toBeNull()
  })

  it('orders results and breaks ties by name length and path', () => {
    const paths = ['Projects/Alpha.md', 'Projection.md', 'My Project.md', 'Old/Projected.md', 'Other.md']
    expect(rankPaths('Proj', paths)).toEqual([
      'Old/Projected.md',
      'Projection.md',
      'My Project.md',
      'Projects/Alpha.md'
    ])
    expect(rankPaths('notes', VAULT)).toEqual(['Notes.md', 'Archive/Notes.md', 'Archive/2025/Notes.md'])
    expect(rankPaths('', VAULT, 3)).toHaveLength(3)
  })
})

describe('vault paths', () => {
  it('converts between absolute and vault paths', () => {
    expect(toVaultPath('/v', '/v/Projects/Alpha.md')).toBe('Projects/Alpha.md')
    expect(toVaultPath('/v/', '/v/a.md')).toBe('a.md')
    expect(toVaultPath('/v', '/vault2/a.md')).toBeNull()
    expect(toVaultPath('C:\\v', 'C:\\v\\Sub\\a.md')).toBe('Sub/a.md')
    expect(toAbsolutePath('C:\\v', 'Sub/a.md')).toBe('C:\\v\\Sub\\a.md')
    expect(toAbsolutePath('/v', 'Sub/a.md')).toBe('/v/Sub/a.md')
  })

  it('computes relative paths and maps renames', () => {
    expect(relativePath('Projects', 'Archive/Notes.md')).toBe('../Archive/Notes.md')
    expect(relativePath('', 'Archive/Notes.md')).toBe('Archive/Notes.md')
    expect(relativePath('Projects', 'Projects/Beta.md')).toBe('Beta.md')
    expect(mapRenamedPath('Projects/Alpha.md', 'Projects', 'Work')).toBe('Work/Alpha.md')
    expect(mapRenamedPath('ProjectsX/Alpha.md', 'Projects', 'Work')).toBeNull()
    expect(mapRenamedPath('Beta.md', 'Beta.md', 'Gamma.md')).toBe('Gamma.md')
  })
})
