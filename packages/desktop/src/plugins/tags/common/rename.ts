import { isMap, isScalar, isSeq, parse, parseDocument, Scalar, type Node } from 'yaml'
import { extractFrontMatter, findBodyTags, isHexColour, normalizeTag } from 'common/markdownExt'

/**
 * Validates a tag typed by the user (leading `#` and trailing `/` allowed) and
 * returns it without them, or null when it is not a valid tag, would be read
 * as a CSS colour or has an empty nesting level (`a//b`).
 */
export const parseTagInput = (raw: string): string | null => {
  const tag = normalizeTag(raw.trim())
  return tag && !isHexColour(tag) && !tag.split('/').includes('') ? tag : null
}

/**
 * The renamed form of `tag` when it is `from` or nested below it
 * (case-insensitive), e.g. `Old/x` → `new/x` for `old` → `new`; null otherwise.
 * The new prefix keeps the casing of `to`; the nested part keeps its own.
 */
export const renameTagName = (tag: string, from: string, to: string): string | null => {
  if (tag.length < from.length) return null
  if (tag.slice(0, from.length).toLowerCase() !== from.toLowerCase()) return null
  if (tag.length > from.length && tag[from.length] !== '/') return null
  return to + tag.slice(from.length)
}

interface TextEdit {
  start: number
  end: number
  replacement: string
}

const applyEdits = (text: string, edits: TextEdit[]): string => {
  let result = text
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

/**
 * Renames the tags inside one front matter string: a single tag or a list
 * separated by commas and/or whitespace, each with an optional `#` (as
 * `getFrontMatterTags` reads it). Separators and `#` are kept.
 */
const renameTagList = (value: string, from: string, to: string): { value: string; count: number } => {
  let count = 0
  const next = value
    .split(/([,\s]+)/)
    .map((part, index) => {
      if (index % 2 === 1 || !part) return part
      const hash = part.startsWith('#') ? '#' : ''
      const tag = normalizeTag(part)
      if (!tag) return part
      const renamed = renameTagName(tag, from, to)
      if (renamed === null) return part
      count++
      return hash + renamed + part.slice(hash.length + tag.length)
    })
    .join('')
  return { value: next, count }
}

/** Source text of `value` written in the style of `node` (plain or quoted). */
const scalarSource = (node: Scalar, value: string): string | null => {
  switch (node.type) {
    case Scalar.QUOTE_DOUBLE:
      return `"${value.replace(/["\\]/g, '\\$&')}"`
    case Scalar.QUOTE_SINGLE:
      return `'${value.replace(/'/g, "''")}'`
    case Scalar.PLAIN:
      // A plain scalar must still read back as this string (`true`, `null`, `1e3` would not).
      try {
        return parse(value) === value ? value : `"${value.replace(/["\\]/g, '\\$&')}"`
      } catch {
        return `"${value.replace(/["\\]/g, '\\$&')}"`
      }
    default:
      return null
  }
}

/**
 * Renames tags in the `tags`/`tag` keys (any case) of front matter YAML.
 * Plain and quoted scalars are rewritten in place, so comments, quoting and
 * the formatting of every other key stay byte-identical; only a block scalar
 * (`|`/`>`) makes the document be re-serialized by the `yaml` library.
 * Invalid YAML is left alone.
 */
export const renameFrontMatterTags = (yaml: string, from: string, to: string): { yaml: string; count: number } => {
  const doc = parseDocument(yaml, { prettyErrors: false })
  if (doc.errors.length > 0 || !isMap(doc.contents)) return { yaml, count: 0 }

  const edits: TextEdit[] = []
  let count = 0
  let reserialize = false

  const visit = (node: Node | null | undefined): void => {
    if (isSeq(node)) {
      for (const item of node.items) visit(item as Node)
      return
    }
    if (!isScalar(node) || typeof node.value !== 'string') return
    const renamed = renameTagList(node.value, from, to)
    if (renamed.count === 0) return
    count += renamed.count
    node.value = renamed.value
    const source = scalarSource(node, renamed.value)
    if (source === null || !node.range) reserialize = true
    else edits.push({ start: node.range[0], end: node.range[1], replacement: source })
  }

  for (const pair of doc.contents.items) {
    const key = isScalar(pair.key) ? pair.key.value : pair.key
    if (typeof key === 'string' && ['tags', 'tag'].includes(key.toLowerCase())) visit(pair.value as Node)
  }

  if (count === 0) return { yaml, count: 0 }
  return { yaml: reserialize ? doc.toString() : applyEdits(yaml, edits), count }
}

export interface TagRenameResult {
  content: string
  /** Renamed occurrences: body tags plus front matter entries. */
  count: number
}

/**
 * Renames `#from` and every nested `#from/…` to `#to…` in a markdown note:
 * body tags at the positions the vault index reads them from (`findBodyTags`,
 * so code, math, HTML, links and URLs are never touched) and the front matter
 * `tags`/`tag` entries. Matching is case-insensitive; the new prefix uses the
 * casing of `to`. CRLF line endings are kept.
 */
export const renameTagInMarkdown = (markdown: string, from: string, to: string): TagRenameResult => {
  const { text, tags } = findBodyTags(markdown)
  const edits: TextEdit[] = []
  for (const { index, tag } of tags) {
    if (renameTagName(tag, from, to) !== null) {
      // The tag body starts after `#`; only the `from` prefix is replaced.
      edits.push({ start: index + 1, end: index + 1 + from.length, replacement: to })
    }
  }
  let count = edits.length

  const frontMatter = extractFrontMatter(text)
  if (frontMatter) {
    const renamed = renameFrontMatterTags(frontMatter.yaml, from, to)
    if (renamed.count > 0) {
      count += renamed.count
      // The YAML starts right after the opening `---\n` fence.
      edits.push({ start: 4, end: 4 + frontMatter.yaml.length, replacement: renamed.yaml })
    }
  }

  if (count === 0) return { content: markdown, count: 0 }
  const content = applyEdits(text, edits)
  return { content: markdown.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content, count }
}
