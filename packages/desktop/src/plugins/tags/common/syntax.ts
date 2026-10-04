import { matchTag, TAG_CHARS_SOURCE } from 'common/markdownExt'
import type { TagCount } from '@shared/plugins/types'

/** Inline token name: the engine renders tags as `span.mu-inline-hashtag`. */
export const HASHTAG_SYNTAX = 'hashtag'

export interface HashtagMatch {
  length: number
  contentStart: number
  contentEnd: number
  data: { tag: string }
}

/**
 * Inline lexer rule: a body tag at the start of `src` with the same rules the
 * vault index uses (`matchTag`). The whole source, `#` included, is token
 * text, so nothing is hidden and the pill look comes from CSS only.
 */
export const matchHashtag = (src: string, prevChar: string): HashtagMatch | null => {
  const match = matchTag(src, prevChar)
  if (!match) return null
  return { length: match.raw.length, contentStart: 0, contentEnd: match.raw.length, data: { tag: match.tag } }
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * Export HTML of a tag token: `<span class="tag">#tag</span>`. A trailing `/`
 * the source carries (`#a/b/`) is not part of the tag and follows the span.
 */
export const exportHashtagHtml = (raw: string, data: Record<string, string>): string => {
  const tagText = `#${data.tag ?? raw.slice(1)}`
  const inside = raw.startsWith(tagText) ? tagText : raw
  return `<span class="tag">${escapeHtml(inside)}</span>${escapeHtml(raw.slice(inside.length))}`
}

/**
 * Completion trigger, tested against the block text before the caret: `#`
 * plus at least one tag character, where the `#` may open a tag (start of the
 * text, whitespace or punctuation before it, except `#&\/` and backtick, as
 * in `isTagBoundary`). Heading markers never match: `# ` has no tag
 * character after it and `##x` has `#` before the last `#`.
 */
export const TAG_COMPLETION_TRIGGER = new RegExp(
  `(?<![^\\s\\p{P}\\p{S}])(?<![#&\\\\/\`])#(${TAG_CHARS_SOURCE})$`,
  'u'
)

/** The rest of the tag word after the caret plus one space: an inserted `#tag ` replaces both. */
export const TAG_COMPLETION_CONSUME_AFTER = new RegExp(`^(?:${TAG_CHARS_SOURCE})? ?`, 'u')

export const MAX_TAG_COMPLETIONS = 50

/**
 * Known tags for a completion query, case-insensitively: tags starting with
 * the query first, then tags containing it elsewhere; within each group the
 * most used first, then by name.
 */
export const rankTagCompletions = (tags: readonly TagCount[], query: string, limit = MAX_TAG_COMPLETIONS): TagCount[] => {
  const needle = query.toLowerCase()
  const ranked: Array<{ entry: TagCount; rank: number }> = []
  for (const entry of tags) {
    const name = entry.tag.toLowerCase()
    if (name.startsWith(needle)) ranked.push({ entry, rank: 0 })
    else if (name.includes(needle)) ranked.push({ entry, rank: 1 })
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.entry.count - a.entry.count ||
      a.entry.tag.toLowerCase().localeCompare(b.entry.tag.toLowerCase())
  )
  return ranked.slice(0, limit).map((item) => item.entry)
}
