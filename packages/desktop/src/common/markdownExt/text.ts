import { parseWikilinkContent } from './wikilinks'

/**
 * Inline markdown reduced to the text a reader sees: wikilinks show their
 * alias (or target), links and images their label, emphasis/code/highlight
 * markers and HTML tags are dropped, escapes resolved, whitespace collapsed.
 */
export const toPlainText = (inline: string): string =>
  inline
    .replace(/`+([^`]*?)`+/g, '$1')
    .replace(/!?\[\[([^[\]\n]+?)\]\]/g, (raw: string, inner: string) => {
      const link = parseWikilinkContent(inner, false)
      if (!link) return raw
      return link.alias ?? (link.target || link.heading || link.blockId || '')
    })
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[A-Za-z][^<>]*>/g, '')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])([*_])(\S(?:.*?\S)?)\2(?![\w*])/g, '$1$3')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Word count with muya's rule (utils/index.ts `wordCount`): every CJK
 * ideograph is a word, everything else is split on whitespace.
 */
export const countWords = (text: string): number => {
  const withoutCjk = text.replace(/[\u4E00-\u9FA5]/g, '')
  const tokens = withoutCjk.split(/\s+/).filter(Boolean)
  return text.length - withoutCjk.length + tokens.length
}

/** `YYYY-MM-DD` when `basename` (file name without extension) is exactly a valid calendar date, else null. */
export const getDailyNoteDate = (basename: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(basename)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? basename : null
}
