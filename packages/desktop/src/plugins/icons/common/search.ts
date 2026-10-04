import { normalizeSearchText, type IconEntry, type IconPack } from './pack'

/**
 * Rank of `icon` for the normalized query, lower is better, or null when it
 * does not match: exact name, name prefix, prefix of a name segment
 * (`arrow-up` for `up`), exact keyword, keyword word prefix, then substring
 * of the name.
 */
const rankIcon = (icon: IconEntry, asName: string, asWords: string): number | null => {
  const { name, keywords } = icon
  if (name === asName) return 0
  if (name.startsWith(asName)) return 1
  if (name.includes(`-${asName}`)) return 2
  if (keywords.includes(asWords)) return 3
  if (keywords.some((keyword) => keyword.startsWith(asWords) || keyword.includes(` ${asWords}`))) return 4
  if (name.includes(asName)) return 5
  return null
}

/**
 * Icons of `pack` matching `query` (a name fragment, Lucide tag or pt-BR
 * synonym; case, accents and spaces vs hyphens are ignored), best first; ties
 * go to the shorter, then alphabetically first name. An empty query lists
 * every icon alphabetically. At most `limit` names are returned.
 */
export const searchIcons = (pack: IconPack, query: string, limit = Infinity): string[] => {
  const normalized = normalizeSearchText(query)
  if (!normalized) return pack.entries.slice(0, limit).map((icon) => icon.name)
  const asName = normalized.replace(/[\s_]+/g, '-')
  const asWords = normalized.replace(/[-_\s]+/g, ' ')
  const ranked: Array<{ name: string; rank: number }> = []
  for (const icon of pack.entries) {
    const rank = rankIcon(icon, asName, asWords)
    if (rank !== null) ranked.push({ name: icon.name, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || (a.name < b.name ? -1 : 1))
  return ranked.slice(0, limit).map((entry) => entry.name)
}
