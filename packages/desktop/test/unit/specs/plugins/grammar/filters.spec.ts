import { describe, expect, it } from 'vitest'
import { isOptedOutByFrontMatter, hashText } from '@plugins/grammar/common/document'
import { classifyMatch, firstHttpsUrl, ignoreKey, isMatchVisible, type MatchFilters } from '@plugins/grammar/common/filters'
import type { GrammarMatch } from '@plugins/grammar/common/types'

const match = (overrides: Partial<GrammarMatch>): GrammarMatch => ({
  offset: 0,
  length: 5,
  message: 'm',
  shortMessage: '',
  replacements: [],
  ruleId: 'RULE',
  ruleDescription: '',
  issueType: 'grammar',
  categoryId: 'GRAMMAR',
  categoryName: 'Gramática',
  urls: [],
  ...overrides
})

const none: MatchFilters = { disabledRules: [], disabledCategories: [], dictionary: [], ignored: new Set() }

describe('grammar match classification', () => {
  it('maps TYPOS to spelling, GRAMMAR to grammar and the rest to style', () => {
    expect(classifyMatch(match({ categoryId: 'TYPOS', issueType: 'misspelling' }))).toBe('spelling')
    expect(classifyMatch(match({ categoryId: 'CUSTOM', issueType: 'misspelling' }))).toBe('spelling')
    expect(classifyMatch(match({ categoryId: 'GRAMMAR', issueType: 'grammar' }))).toBe('grammar')
    expect(classifyMatch(match({ categoryId: 'TYPOGRAPHY', issueType: 'typographical' }))).toBe('style')
    expect(classifyMatch(match({ categoryId: 'STYLE', issueType: 'style' }))).toBe('style')
    expect(classifyMatch(match({ categoryId: 'REDUNDANCY', issueType: 'duplication' }))).toBe('style')
  })
})

describe('grammar match filters', () => {
  const text = 'Texto marktext aqui'
  const spelling = match({ offset: 6, length: 8, ruleId: 'HUNSPELL_RULE', categoryId: 'TYPOS', issueType: 'misspelling' })

  it('shows everything without filters', () => {
    expect(isMatchVisible(spelling, text, none)).toBe(true)
  })

  it('hides disabled rules, including a rule id with sub-id', () => {
    expect(isMatchVisible(spelling, text, { ...none, disabledRules: ['HUNSPELL_RULE'] })).toBe(false)
    const withSub = match({ ruleId: 'AGREEMENT', ruleSubId: '3' })
    expect(isMatchVisible(withSub, text, { ...none, disabledRules: ['AGREEMENT[3]'] })).toBe(false)
    expect(isMatchVisible(withSub, text, { ...none, disabledRules: ['AGREEMENT[2]'] })).toBe(true)
  })

  it('hides disabled categories', () => {
    expect(isMatchVisible(spelling, text, { ...none, disabledCategories: ['TYPOS'] })).toBe(false)
    expect(isMatchVisible(spelling, text, { ...none, disabledCategories: ['GRAMMAR'] })).toBe(true)
  })

  it('hides spelling matches of dictionary words (exact match) but not other kinds', () => {
    expect(isMatchVisible(spelling, text, { ...none, dictionary: ['marktext'] })).toBe(false)
    expect(isMatchVisible(spelling, text, { ...none, dictionary: ['MarkText'] })).toBe(true)
    const grammar = match({ offset: 6, length: 8 })
    expect(isMatchVisible(grammar, text, { ...none, dictionary: ['marktext'] })).toBe(true)
  })

  it('hides session-ignored matches by rule and flagged text, wherever they appear', () => {
    const ignored = new Set([ignoreKey(spelling, 'marktext')])
    expect(isMatchVisible(spelling, text, { ...none, ignored })).toBe(false)
    expect(isMatchVisible({ ...spelling, offset: 0, length: 5 }, text, { ...none, ignored })).toBe(true)
    expect(isMatchVisible(spelling, 'Outra palavrinha.', { ...none, ignored })).toBe(true)
    expect(isMatchVisible({ ...spelling, offset: 4 }, 'Um: marktext.', { ...none, ignored })).toBe(false)
  })

  it('opens only https rule links', () => {
    expect(firstHttpsUrl(['javascript:alert(1)', 'http://x.y', 'not a url', 'https://ok.example/rule'])).toBe(
      'https://ok.example/rule'
    )
    expect(firstHttpsUrl(['file:///etc/passwd'])).toBeNull()
  })
})

describe('front matter opt-out', () => {
  it('skips files with languagetool: false', () => {
    expect(isOptedOutByFrontMatter('---\nlanguagetool: false\n---\n\nTexto')).toBe(true)
    expect(isOptedOutByFrontMatter('---\ntitle: x\nlanguagetool: off\n---\n\nTexto')).toBe(true)
    expect(isOptedOutByFrontMatter('---\nlanguagetool: "No"\n---\n\nTexto')).toBe(true)
  })

  it('checks files without the key, with other values, or with invalid front matter', () => {
    expect(isOptedOutByFrontMatter('Texto')).toBe(false)
    expect(isOptedOutByFrontMatter('---\nlanguagetool: true\n---\n\nTexto')).toBe(false)
    expect(isOptedOutByFrontMatter('---\ntitle: x\n---\n\nlanguagetool: false')).toBe(false)
    expect(isOptedOutByFrontMatter('---\nlanguagetool: false\nlanguagetool: false\n---\n\nTexto')).toBe(false)
  })
})

describe('block text hash', () => {
  it('differs for different texts and is stable', () => {
    expect(hashText('Eu vai')).toBe(hashText('Eu vai'))
    expect(hashText('Eu vai')).not.toBe(hashText('Eu vou'))
    expect(hashText('')).not.toBe(hashText(' '))
  })
})
