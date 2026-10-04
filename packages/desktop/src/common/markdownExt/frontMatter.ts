import { parseDocument } from 'yaml'
import { normalizeTag } from './tags'

/**
 * YAML front matter exactly as muya recognises it (see muya
 * utils/marked/frontMatter.ts): `---` on the first line, a lazily matched
 * closing `---`, then a blank line or the end of the document. TOML (`+++`)
 * and JSON (`;;;`, `{`) front matter are not metadata sources.
 */
const YAML_FRONT_MATTER = /^---\n([\s\S]+?)---(?:\n{2,}|\n{1,2}$)/

export interface FrontMatterBlock {
  /** YAML source between the fences. */
  yaml: string
  /** 0-based line of the closing `---`. */
  endLine: number
}

/** Locates the front matter of an LF-normalized document, or returns null. */
export const extractFrontMatter = (markdown: string): FrontMatterBlock | null => {
  const match = YAML_FRONT_MATTER.exec(markdown)
  if (!match) return null
  const yaml = match[1]
  // Line 0 is the opening fence; the closing fence sits on the line where the YAML text ends.
  return { yaml, endLine: yaml.split('\n').length }
}

/**
 * Parses YAML into a plain object. Anything that is not a mapping, or that
 * has syntax errors (duplicate keys included), yields null; never throws.
 */
export const parseYamlObject = (yaml: string): Record<string, unknown> | null => {
  try {
    const doc = parseDocument(yaml, { prettyErrors: false })
    if (doc.errors.length > 0) return null
    const value: unknown = doc.toJS({ maxAliasCount: 100 })
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

/** Parsed front matter of an LF-normalized document, or null when absent or invalid. */
export const parseFrontMatter = (markdown: string): Record<string, unknown> | null => {
  const block = extractFrontMatter(markdown)
  return block ? parseYamlObject(block.yaml) : null
}

const getKeyCaseInsensitive = (frontmatter: Record<string, unknown>, keys: string[]): unknown[] => {
  const values: unknown[] = []
  for (const [key, value] of Object.entries(frontmatter)) {
    if (keys.includes(key.toLowerCase())) values.push(value)
  }
  return values
}

const flattenStrings = (value: unknown, separator: RegExp): string[] => {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap((item) => flattenStrings(item, separator))
  if (typeof value === 'string') return value.split(separator)
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  return []
}

/**
 * Tags of the `tags`/`tag` keys (any case): a list or a string separated by
 * commas and/or whitespace; a leading `#` is optional. Invalid tags are
 * dropped; duplicates are kept (callers de-duplicate with body tags).
 */
export const getFrontMatterTags = (frontmatter: Record<string, unknown> | null): string[] => {
  if (!frontmatter) return []
  const tags: string[] = []
  for (const raw of getKeyCaseInsensitive(frontmatter, ['tags', 'tag'])) {
    for (const item of flattenStrings(raw, /[,\s]+/)) {
      const tag = normalizeTag(item.trim())
      if (tag) tags.push(tag)
    }
  }
  return tags
}

/** Aliases of the `aliases`/`alias` keys (any case): a list or a comma-separated string. */
export const getFrontMatterAliases = (frontmatter: Record<string, unknown> | null): string[] => {
  if (!frontmatter) return []
  const aliases: string[] = []
  const seen = new Set<string>()
  for (const raw of getKeyCaseInsensitive(frontmatter, ['aliases', 'alias'])) {
    for (const item of flattenStrings(raw, /,/)) {
      const alias = item.trim()
      if (alias && !seen.has(alias)) {
        seen.add(alias)
        aliases.push(alias)
      }
    }
  }
  return aliases
}
