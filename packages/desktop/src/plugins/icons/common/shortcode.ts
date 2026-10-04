import type { InlineSyntaxMatch } from '@/plugins/types'

/** Prefix of Lucide shortcodes: `:lucide-<name>:`. */
export const LUCIDE_PREFIX = 'lucide'

const SHORTCODE_RE = /^:([a-z0-9]+)-([a-z0-9-]+):/
const SHORTCODE_GLOBAL_RE = /(?<!\w):([a-z0-9]+)-([a-z0-9-]+):/g

/**
 * Matches an icon shortcode `:<prefix>-<name>:` at the start of `src`, only
 * when `hasIcon(name)` and the opening `:` is not glued to a word character
 * (the same boundary the emoji rule uses, so `12:lucide-x:` stays text).
 * Unknown names return null and are left to the emoji rule. The whole
 * shortcode is marker text (empty content range): the engine hides it unless
 * the caret is inside and CSS draws the icon in its place.
 */
export const matchIconShortcode = (
  src: string,
  prevChar: string,
  prefix: string,
  hasIcon: (name: string) => boolean
): InlineSyntaxMatch | null => {
  if (src.charCodeAt(0) !== 58 /* : */ || (prevChar !== '' && /\w/.test(prevChar))) return null
  const match = SHORTCODE_RE.exec(src)
  if (!match || match[1] !== prefix || !hasIcon(match[2])) return null
  return { length: match[0].length, contentStart: 0, contentEnd: 0, data: { icon: match[2] } }
}

/**
 * Names of the known icons written as shortcodes anywhere in `markdown`,
 * including spots the engine does not render (code); callers use it to decide
 * which icons need styles, where extras are harmless.
 */
export const findIconShortcodes = (
  markdown: string,
  prefix: string,
  hasIcon: (name: string) => boolean
): Set<string> => {
  const names = new Set<string>()
  for (const match of markdown.matchAll(SHORTCODE_GLOBAL_RE)) {
    if (match[1] === prefix && hasIcon(match[2])) names.add(match[2])
  }
  return names
}

/** The shortcode inserted for `name`. */
export const formatShortcode = (prefix: string, name: string): string => `:${prefix}-${name}:`
