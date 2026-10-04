import { describe, expect, it } from 'vitest'
import { buildPageLink, formatPageLink, shortestLinkTarget, toVaultPath } from '@plugins/pdf-reader/common/link'

describe('toVaultPath', () => {
  it('returns the POSIX path below the vault root', () => {
    expect(toVaultPath('/vault', '/vault/Attachments/sample.pdf')).toBe('Attachments/sample.pdf')
    expect(toVaultPath('/vault/', '/vault/sample.pdf')).toBe('sample.pdf')
  })

  it('rejects files outside the vault, including sibling folders sharing a prefix', () => {
    expect(toVaultPath('/vault', '/other/sample.pdf')).toBeNull()
    expect(toVaultPath('/vault', '/vault-old/sample.pdf')).toBeNull()
    expect(toVaultPath('/vault', '/vault')).toBeNull()
  })

  it('handles Windows paths case-insensitively', () => {
    expect(toVaultPath('C:\\Users\\Me\\Vault', 'c:\\users\\me\\vault\\Docs\\Paper.pdf')).toBe('Docs/Paper.pdf')
  })
})

describe('shortestLinkTarget', () => {
  it('uses the file name when it is unique in the vault', () => {
    expect(shortestLinkTarget('Attachments/sample.pdf', ['Attachments/sample.pdf', 'Other/report.pdf'])).toBe(
      'sample.pdf'
    )
  })

  it('uses the full vault path when another file has the same name, ignoring case', () => {
    const paths = ['Attachments/sample.pdf', 'Archive/Sample.PDF']
    expect(shortestLinkTarget('Attachments/sample.pdf', paths)).toBe('Attachments/sample.pdf')
    expect(shortestLinkTarget('Archive/Sample.PDF', paths)).toBe('Archive/Sample.PDF')
  })
})

describe('formatPageLink', () => {
  it('writes an Obsidian wikilink to the page', () => {
    expect(formatPageLink('sample.pdf', 2)).toBe('[[sample.pdf#page=2]]')
    expect(formatPageLink('Papers/My paper.pdf', 10)).toBe('[[Papers/My paper.pdf#page=10]]')
  })

  it('falls back to a markdown link when the target cannot live in a wikilink', () => {
    expect(formatPageLink('Docs/C# notes [v2].pdf', 3)).toBe('[C# notes \\[v2\\].pdf](Docs/C%23%20notes%20%5Bv2%5D.pdf#page=3)')
    expect(formatPageLink('a|b.pdf', 1)).toBe('[a|b.pdf](a%7Cb.pdf#page=1)')
  })
})

describe('buildPageLink', () => {
  const vaultFiles = ['/vault/Attachments/sample.pdf', '/vault/Archive/old.pdf']

  it('links by file name when it is unique', () => {
    expect(buildPageLink({ absolutePath: '/vault/Attachments/sample.pdf', rootPath: '/vault', vaultFiles, page: 2 })).toBe(
      '[[sample.pdf#page=2]]'
    )
  })

  it('links by vault path when the name is ambiguous or the file list is unknown', () => {
    const ambiguous = [...vaultFiles, '/vault/Archive/sample.pdf']
    expect(
      buildPageLink({ absolutePath: '/vault/Attachments/sample.pdf', rootPath: '/vault', vaultFiles: ambiguous, page: 4 })
    ).toBe('[[Attachments/sample.pdf#page=4]]')
    expect(
      buildPageLink({ absolutePath: '/vault/Attachments/sample.pdf', rootPath: '/vault', vaultFiles: null, page: 1 })
    ).toBe('[[Attachments/sample.pdf#page=1]]')
  })

  it('ignores listed files outside the vault and links bare names without a vault', () => {
    expect(
      buildPageLink({
        absolutePath: '/vault/sample.pdf',
        rootPath: '/vault',
        vaultFiles: ['/vault/sample.pdf', '/elsewhere/sample.pdf'],
        page: 1
      })
    ).toBe('[[sample.pdf#page=1]]')
    expect(buildPageLink({ absolutePath: '/docs/sample.pdf', rootPath: null, vaultFiles: [], page: 3 })).toBe(
      '[[sample.pdf#page=3]]'
    )
    expect(buildPageLink({ absolutePath: '/docs/sample.pdf', rootPath: '/vault', vaultFiles: [], page: 3 })).toBe(
      '[[sample.pdf#page=3]]'
    )
  })
})
