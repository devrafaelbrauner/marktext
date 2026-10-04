import type { HeadingEntry, LinkReference, TaskEntry } from '@shared/plugins/types'
import { getFrontMatterAliases, getFrontMatterTags, parseYamlObject } from './frontMatter'
import { addInlineField, findBracketFields, matchLineField } from './inlineFields'
import { lineOfOffset, maskDocument } from './mask'
import { findMarkdownLinks } from './markdownLinks'
import { findTags } from './tags'
import { countWords, toPlainText } from './text'
import { parseWikilinkContent, WIKILINK_SOURCE } from './wikilinks'

/** A link as parsed from one note; the index fills in `resolved`. */
export type ParsedLink = Omit<LinkReference, 'resolved'>

/** Everything `FileMetadata` holds that derives from the note's content alone. */
export interface NoteMetadata {
  frontmatter: Record<string, unknown> | null
  aliases: string[]
  tags: string[]
  headings: HeadingEntry[]
  /** Wikilinks and markdown links in document order. */
  links: ParsedLink[]
  tasks: TaskEntry[]
  fields: Record<string, unknown>
  wordCount: number
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST_OR_QUOTE = /^[ \t]*(?:>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/
const TASK = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([^\]\n])\])(?:[ \t]+(.*))?$/
const LINE_PREFIX = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?/
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]*|\bwww\.[^\s<>]*/gi

const blankRange = (chars: string[], start: number, end: number): void => {
  for (let k = start; k < end; k++) {
    if (chars[k] !== '\n') chars[k] = ' '
  }
}

const isParagraphLine = (line: string): boolean =>
  !!line.trim() &&
  !/^ {4}|^\t/.test(line) &&
  !ATX_HEADING.test(line) &&
  !SETEXT_UNDERLINE.test(line) &&
  !THEMATIC_BREAK.test(line) &&
  !LIST_OR_QUOTE.test(line) &&
  !/^\s*[|<]/.test(line)

/**
 * Extracts note metadata from markdown source. Pure and total: malformed
 * markdown or YAML never throws. Lines and columns are 0-based and refer to
 * the source with its line endings normalized (CRLF counts as one break).
 */
export const parseNote = (markdown: string): NoteMetadata => {
  const doc = maskDocument(markdown)
  const { text, lineStarts, frontMatterEndLine } = doc
  const position = (offset: number): { line: number; column: number } => {
    const line = lineOfOffset(lineStarts, offset)
    return { line, column: offset - lineStarts[line] }
  }

  const frontmatter = doc.frontMatter ? parseYamlObject(doc.frontMatter.yaml) : null

  // Links: wikilinks first, then markdown links in text where wikilinks are blanked.
  const linkMasked = doc.inline.split('')
  const found: Array<{ offset: number; link: ParsedLink }> = []
  const wikilinkRegex = new RegExp(WIKILINK_SOURCE, 'g')
  let match: RegExpExecArray | null
  while ((match = wikilinkRegex.exec(doc.inline)) !== null) {
    const embed = match[0].startsWith('!')
    const innerStart = match.index + (embed ? 3 : 2)
    const parsed = parseWikilinkContent(text.slice(innerStart, innerStart + match[1].length), embed)
    blankRange(linkMasked, match.index, match.index + match[0].length)
    if (parsed) {
      found.push({ offset: match.index, link: { ...parsed, kind: 'wikilink', ...position(match.index) } })
    }
  }
  const linkMaskedText = linkMasked.join('')
  const tagMasked = linkMasked
  for (const markdownLink of findMarkdownLinks(linkMaskedText, text)) {
    blankRange(tagMasked, markdownLink.start, markdownLink.end)
    found.push({
      offset: markdownLink.start,
      link: {
        ...markdownLink.destination,
        embed: markdownLink.embed,
        kind: 'markdown',
        ...position(markdownLink.start)
      }
    })
  }
  found.sort((a, b) => a.offset - b.offset)

  // Tags: front matter first, then body tags outside links and URLs.
  let tagText = tagMasked.join('')
  tagText = tagText.replace(URL, (url) => ' '.repeat(url.length))
  const tags: string[] = []
  const seenTags = new Set<string>()
  for (const tag of [...getFrontMatterTags(frontmatter), ...findTags(tagText).map((t) => t.tag)]) {
    const key = tag.toLowerCase()
    if (!seenTags.has(key)) {
      seenTags.add(key)
      tags.push(tag)
    }
  }

  // Line-based structure: headings, tasks and inline fields.
  const lines = text.split('\n')
  const blockLines = doc.block.split('\n')
  const inlineLines = doc.inline.split('\n')
  const headings: HeadingEntry[] = []
  const tasks: TaskEntry[] = []
  const fields: Record<string, unknown> = {}

  for (let i = frontMatterEndLine + 1; i < lines.length; i++) {
    const blockLine = blockLines[i]
    if (!blockLine.trim()) continue

    const atx = ATX_HEADING.exec(blockLine)
    if (atx) {
      headings.push({ level: atx[1].length, text: toPlainText(atx[2] ?? ''), line: i })
      continue
    }

    const underline = SETEXT_UNDERLINE.exec(blockLine)
    if (underline && i - 1 > frontMatterEndLine && isParagraphLine(blockLines[i - 1])) {
      let start = i - 1
      while (start - 1 > frontMatterEndLine && isParagraphLine(blockLines[start - 1])) start--
      headings.push({
        level: underline[1][0] === '=' ? 1 : 2,
        text: toPlainText(blockLines.slice(start, i).join(' ')),
        line: start
      })
      continue
    }

    const inlineLine = inlineLines[i]
    const task = TASK.exec(blockLine)
    if (task) {
      const taskFields: Record<string, unknown> = {}
      const rest = task[3] ?? ''
      const restStart = blockLine.length - rest.length
      const lineField = matchLineField(inlineLine.slice(restStart)) ? matchLineField(lines[i].slice(restStart)) : null
      const fieldMatches = lineField
        ? [lineField]
        : findBracketFields(inlineLine.slice(task[1].length), lines[i].slice(task[1].length))
      for (const field of fieldMatches) {
        addInlineField(taskFields, field.key, field.value)
        addInlineField(fields, field.key, field.value)
      }
      tasks.push({ text: rest.trim(), checked: task[2] !== ' ', status: task[2], line: i, fields: taskFields })
      continue
    }

    const prefixLength = LINE_PREFIX.exec(inlineLine)?.[0].length ?? 0
    const lineField = matchLineField(inlineLine.slice(prefixLength)) ? matchLineField(lines[i].slice(prefixLength)) : null
    for (const field of lineField ? [lineField] : findBracketFields(inlineLine, lines[i])) {
      addInlineField(fields, field.key, field.value)
    }
  }
  headings.sort((a, b) => a.line - b.line)

  const bodyStart = frontMatterEndLine >= 0 ? (lineStarts[frontMatterEndLine + 1] ?? text.length) : 0

  return {
    frontmatter,
    aliases: getFrontMatterAliases(frontmatter),
    tags,
    headings,
    links: found.map((entry) => entry.link),
    tasks,
    fields,
    wordCount: countWords(text.slice(bodyStart))
  }
}
