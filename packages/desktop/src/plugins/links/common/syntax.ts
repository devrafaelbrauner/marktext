import { getLinkExtension, matchWikilink, type ParsedWikilink } from 'common/markdownExt'

/** `data-*` payload of a rendered wikilink token (only keys that are set). */
export type WikilinkData = Partial<Record<'target' | 'alias' | 'heading' | 'blockId' | 'subpath' | 'embed', string>>

export interface WikilinkTokenMatch {
  length: number
  contentStart: number
  contentEnd: number
  data: WikilinkData
}

export const toWikilinkData = (link: ParsedWikilink): WikilinkData => {
  const data: WikilinkData = { target: link.target }
  if (link.alias !== undefined) data.alias = link.alias
  if (link.heading !== undefined) data.heading = link.heading
  if (link.blockId !== undefined) data.blockId = link.blockId
  if (link.subpath !== undefined) data.subpath = link.subpath
  if (link.embed) data.embed = 'true'
  return data
}

/**
 * Inline-lexer rule for `[[…]]`/`![[…]]`. The visible part is the alias
 * (after the first `|`, also `\|` inside tables) or, without alias, the
 * whole text between the brackets (target plus `#heading`); the brackets,
 * `!` and the target part of aliased links are markers.
 */
export const matchWikilinkToken = (src: string, prevChar: string): WikilinkTokenMatch | null => {
  if (prevChar === '\\' || (src[0] !== '[' && src[0] !== '!')) return null
  const matched = matchWikilink(src)
  if (!matched) return null
  const { raw, link } = matched
  const open = link.embed ? 3 : 2
  const close = raw.length - 2
  let contentStart = open
  if (link.alias !== undefined) {
    const pipe = raw.indexOf('|', open)
    contentStart = pipe + 1
  }
  if (contentStart >= close) contentStart = open
  return { length: raw.length, contentStart, contentEnd: close, data: toWikilinkData(link) }
}

/** Text a reader sees: the alias, else the target with its `#heading`/`^block`/subpath. */
export const wikilinkDisplayText = (data: WikilinkData): string => {
  if (data.alias) return data.alias
  const fragment = data.heading ?? (data.blockId ? `^${data.blockId}` : data.subpath)
  if (!data.target) return fragment ?? ''
  return fragment ? `${data.target}#${fragment}` : data.target
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/**
 * Relative href of a wikilink in exported HTML: the target (plus `.md` when
 * it has no extension), with the heading, `^block` or subpath as fragment.
 */
export const wikilinkHref = (data: WikilinkData): string => {
  const target = data.target ?? ''
  const file = target && !getLinkExtension(target) ? `${target}.md` : target
  const fragment = data.subpath ?? (data.heading ?? (data.blockId ? `^${data.blockId}` : undefined))
  const encodedFragment = fragment === undefined ? '' : `#${encodeURIComponent(fragment)}`
  return encodePath(file) + encodedFragment
}

export const exportWikilinkHtml = (data: WikilinkData): string =>
  `<a href="${escapeHtml(wikilinkHref(data))}">${escapeHtml(wikilinkDisplayText(data))}</a>`
