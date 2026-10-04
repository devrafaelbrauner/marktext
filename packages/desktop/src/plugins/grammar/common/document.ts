import { parseFrontMatter } from 'common/markdownExt'

const OPT_OUT_VALUES: Record<string, true> = { false: true, off: true, no: true }

/** True when the front matter has `languagetool: false` (also `off`/`no`, any case). */
export const isOptedOutByFrontMatter = (markdown: string): boolean => {
  const frontmatter = parseFrontMatter(markdown)
  if (!frontmatter || !('languagetool' in frontmatter)) return false
  const value = frontmatter.languagetool
  if (value === false) return true
  return typeof value === 'string' && OPT_OUT_VALUES[value.trim().toLowerCase()] === true
}

/** 53-bit string hash (cyrb53); used as a cache key for block texts, not for security. */
export const hashText = (text: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + text.length.toString(36)
}
