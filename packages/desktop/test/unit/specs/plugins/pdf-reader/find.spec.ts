import { describe, expect, it } from 'vitest'
import {
  buildPageText,
  countMatches,
  findMatches,
  firstMatchFrom,
  foldText,
  matchOrdinal,
  stepMatch,
  toItemRanges,
  type TextRange
} from '@plugins/pdf-reader/common/find'

const search = (text: string, query: string): string[] =>
  findMatches(foldText(text), query).map(({ start, end }) => text.slice(start, end))

describe('page text', () => {
  it('joins the text items, breaking lines after items flagged hasEOL', () => {
    const page = buildPageText([{ str: 'Hello ' }, { str: 'world', hasEOL: true }, { str: 'again' }])
    expect(page.text).toBe('Hello world\nagain')
    expect(page.itemStarts).toEqual([0, 6, 12])
    expect(page.itemLengths).toEqual([6, 5, 5])
  })
})

describe('findMatches', () => {
  it('ignores case and returns non-overlapping matches in order', () => {
    expect(search('Page 1. PAGE two, page', 'page')).toEqual(['Page', 'PAGE', 'page'])
    expect(search('aaaa', 'aa')).toEqual(['aa', 'aa'])
  })

  it('ignores diacritics in both directions and keeps source offsets', () => {
    expect(search('Ação e reação', 'acao')).toEqual(['Ação', 'ação'])
    expect(search('Acao', 'ação')).toEqual(['Acao'])
    // Decomposed text (letter + combining accent) maps back to both code units.
    expect(search('cafe\u0301 au lait', 'café')).toEqual(['cafe\u0301'])
  })

  it('matches ligatures and full-width forms by their compatibility decomposition', () => {
    expect(search('the ﬁnal ﬁle', 'final')).toEqual(['ﬁnal'])
    expect(search('ＡＢＣ', 'abc')).toEqual(['ＡＢＣ'])
  })

  it('lets any whitespace run match any other, across line breaks', () => {
    const page = buildPageText([{ str: 'the quick', hasEOL: true }, { str: 'brown   fox' }])
    const ranges = findMatches(foldText(page.text), 'quick brown fox')
    expect(ranges.map(({ start, end }) => page.text.slice(start, end))).toEqual(['quick\nbrown   fox'])
    expect(search('a\t\tb', 'a b')).toEqual(['a\t\tb'])
  })

  it('handles characters outside the BMP', () => {
    expect(search('x 😀 y 😀', '😀 y')).toEqual(['😀 y'])
  })

  it('finds nothing for an empty or blank query', () => {
    expect(search('some text', '')).toEqual([])
    expect(search('some text', '   ')).toEqual([])
  })
})

describe('toItemRanges', () => {
  it('splits a match over the text items it spans, skipping separators', () => {
    const page = buildPageText([{ str: 'Hello wo', hasEOL: false }, { str: 'rld', hasEOL: true }, { str: 'next' }])
    const [match] = findMatches(foldText(page.text), 'world')
    expect(toItemRanges(page, match)).toEqual([
      { item: 0, start: 6, end: 8 },
      { item: 1, start: 0, end: 3 }
    ])
    const [lineBreak] = findMatches(foldText(page.text), 'rld next')
    expect(toItemRanges(page, lineBreak)).toEqual([
      { item: 1, start: 0, end: 3 },
      { item: 2, start: 0, end: 4 }
    ])
  })

  it('skips empty items', () => {
    const page = buildPageText([{ str: 'ab' }, { str: '' }, { str: 'cd' }])
    expect(toItemRanges(page, { start: 1, end: 3 })).toEqual([
      { item: 0, start: 1, end: 2 },
      { item: 2, start: 0, end: 1 }
    ])
  })
})

describe('match navigation', () => {
  const r = (start: number): TextRange => ({ start, end: start + 1 })
  // Page 0: two matches, page 1: none, page 2: one, page 3: not searched yet.
  const matches = [[r(0), r(5)], [], [r(2)], undefined]

  it('counts the matches found so far', () => {
    expect(countMatches(matches)).toBe(3)
    expect(countMatches([])).toBe(0)
  })

  it('starts at the first match on or after a page, wrapping around', () => {
    expect(firstMatchFrom(matches, 1)).toEqual({ page: 2, index: 0 })
    expect(firstMatchFrom(matches, 3)).toEqual({ page: 0, index: 0 })
    expect(firstMatchFrom([[], undefined], 0)).toBeNull()
  })

  it('steps forward and backward across pages and wraps at the ends', () => {
    expect(stepMatch(matches, { page: 0, index: 0 }, 1)).toEqual({ page: 0, index: 1 })
    expect(stepMatch(matches, { page: 0, index: 1 }, 1)).toEqual({ page: 2, index: 0 })
    expect(stepMatch(matches, { page: 2, index: 0 }, 1)).toEqual({ page: 0, index: 0 })
    expect(stepMatch(matches, { page: 0, index: 0 }, -1)).toEqual({ page: 2, index: 0 })
    expect(stepMatch(matches, { page: 2, index: 0 }, -1)).toEqual({ page: 0, index: 1 })
  })

  it('stays on the only match', () => {
    expect(stepMatch([[r(1)]], { page: 0, index: 0 }, 1)).toEqual({ page: 0, index: 0 })
    expect(stepMatch([], { page: 0, index: 0 }, 1)).toBeNull()
  })

  it('numbers a match by the matches before it', () => {
    expect(matchOrdinal(matches, { page: 0, index: 0 })).toBe(1)
    expect(matchOrdinal(matches, { page: 0, index: 1 })).toBe(2)
    expect(matchOrdinal(matches, { page: 2, index: 0 })).toBe(3)
  })
})
