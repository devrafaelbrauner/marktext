import type { GrammarMatch } from './types'

export type ProblemKind = 'spelling' | 'grammar' | 'style'

export const DECORATION_CLASS: Record<ProblemKind, string> = {
  spelling: 'mu-decoration-spelling',
  grammar: 'mu-decoration-grammar',
  style: 'mu-decoration-style'
}

/** TYPOS (category or misspelling issue) → spelling, GRAMMAR → grammar, everything else → style. */
export const classifyMatch = (match: GrammarMatch): ProblemKind => {
  if (match.categoryId === 'TYPOS' || match.issueType === 'misspelling') return 'spelling'
  if (match.categoryId === 'GRAMMAR' || match.issueType === 'grammar') return 'grammar'
  return 'style'
}

/** Session "ignore" key: the rule together with the flagged text, so the same mistake is ignored wherever it appears. */
export const ignoreKey = (match: GrammarMatch, flaggedText: string): string => `${match.ruleId}\u0000${flaggedText}`

export interface MatchFilters {
  disabledRules: readonly string[]
  disabledCategories: readonly string[]
  /** Personal dictionary; hides spelling matches whose flagged word is listed (exact match). */
  dictionary: readonly string[]
  /** Keys produced by `ignoreKey`. */
  ignored: ReadonlySet<string>
}

/**
 * Whether a match of `blockText` should be shown. `disabledRules` accepts a
 * rule id (`PT_AGREEMENT`) or a rule id with sub-id (`PT_AGREEMENT[2]`).
 */
export const isMatchVisible = (match: GrammarMatch, blockText: string, filters: MatchFilters): boolean => {
  if (filters.disabledRules.includes(match.ruleId)) return false
  if (match.ruleSubId && filters.disabledRules.includes(`${match.ruleId}[${match.ruleSubId}]`)) return false
  if (filters.disabledCategories.includes(match.categoryId)) return false
  const flagged = blockText.slice(match.offset, match.offset + match.length)
  if (filters.ignored.has(ignoreKey(match, flagged))) return false
  if (classifyMatch(match) === 'spelling' && filters.dictionary.includes(flagged.trim())) return false
  return true
}

/** First rule link that may be opened in the browser (https only). */
export const firstHttpsUrl = (urls: readonly string[]): string | null => {
  for (const url of urls) {
    try {
      if (new URL(url).protocol === 'https:') return url
    } catch {
      // Not a URL; try the next one.
    }
  }
  return null
}
