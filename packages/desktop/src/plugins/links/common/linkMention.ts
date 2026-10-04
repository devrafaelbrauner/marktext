import type { MentionMatch } from './mentions'

/**
 * Replaces one unlinked mention with a wikilink: `[[Name]]` when the mention
 * is written exactly like `linkText`, else `[[linkText|mention]]` so the
 * prose reads the same. Returns null when the text at the mention's offsets
 * changed since it was found. Line endings of `markdown` are kept.
 */
export const linkMentionInText = (
  markdown: string,
  mention: Pick<MentionMatch, 'start' | 'end' | 'text'>,
  linkText: string
): string | null => {
  const crlf = /\r\n/.test(markdown)
  const text = markdown.replace(/\r\n?/g, '\n')
  if (text.slice(mention.start, mention.end) !== mention.text) return null
  const link = mention.text === linkText ? `[[${linkText}]]` : `[[${linkText}|${mention.text}]]`
  const next = text.slice(0, mention.start) + link + text.slice(mention.end)
  return crlf ? next.replace(/\n/g, '\r\n') : next
}
