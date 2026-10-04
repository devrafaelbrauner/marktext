import { PT_BR_SYNONYMS } from './synonyms'

/** One SVG child element of a Lucide icon as listed in `lucide-static/icon-nodes.json`. */
export type IconNode = [tag: string, attrs: Record<string, string>]

export interface IconEntry {
  /** Kebab-case Lucide name, e.g. `house`. */
  name: string
  nodes: IconNode[]
  /**
   * Search keywords: Lucide tags plus pt-BR synonyms, lower-cased and without
   * diacritics (see `normalizeSearchText`).
   */
  keywords: string[]
}

/** An icon set loaded in memory. */
export interface IconPack {
  /** Shortcode prefix: icons are written `:<prefix>-<name>:`. */
  prefix: string
  /** Sorted alphabetically by name; names are unique. */
  entries: IconEntry[]
  get(name: string): IconEntry | undefined
}

/** Lower-cases `text` and strips diacritics, so `Coração` matches `coracao`. */
export const normalizeSearchText = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

/**
 * Builds a pack from Lucide's `icon-nodes.json` and `tags.json` shapes. Icons
 * without tags get only their pt-BR synonyms as keywords.
 */
export const createIconPack = (
  prefix: string,
  nodes: Record<string, IconNode[]>,
  tags: Record<string, string[]>
): IconPack => {
  const entries = new Map<string, IconEntry>()
  for (const name of Object.keys(nodes).sort()) {
    const keywords = [...(tags[name] ?? []), ...(PT_BR_SYNONYMS[name] ?? [])].map(normalizeSearchText)
    entries.set(name, { name, nodes: nodes[name], keywords: [...new Set(keywords)] })
  }
  return {
    prefix,
    entries: [...entries.values()],
    get: (name) => entries.get(name)
  }
}
