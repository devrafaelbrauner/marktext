import { noteName } from './paths'

export const MAX_COMPLETION_ITEMS = 50

/** 0 prefix, 1 word start, 2 substring of the name, 3 substring of the path; null when unrelated. */
export const matchRank = (query: string, path: string): number | null => {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const name = noteName(path).toLowerCase()
  if (name.startsWith(q)) return 0
  const index = name.indexOf(q)
  if (index !== -1) {
    let at = index
    while (at !== -1) {
      if (/[\s\-_.()[\]]/.test(name[at - 1])) return 1
      at = name.indexOf(q, at + 1)
    }
    return 2
  }
  return path.toLowerCase().includes(q) ? 3 : null
}

/** Vault paths matching `query`, best first (rank, then shorter name, then shorter path), at most `limit`. */
export const rankPaths = (query: string, paths: Iterable<string>, limit = MAX_COMPLETION_ITEMS): string[] => {
  const scored: Array<{ path: string; rank: number; nameLength: number }> = []
  for (const path of paths) {
    const rank = matchRank(query, path)
    if (rank !== null) scored.push({ path, rank, nameLength: noteName(path).length })
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.nameLength - b.nameLength ||
      a.path.length - b.path.length ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  )
  return scored.slice(0, limit).map((entry) => entry.path)
}
