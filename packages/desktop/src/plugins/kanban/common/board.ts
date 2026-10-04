/**
 * Obsidian Kanban board format (https://github.com/obsidian-community/obsidian-kanban):
 * front matter `kanban-plugin: board`, one heading per lane (`## Title`,
 * optional WIP limit `## Title (3)`), one list item per card (`- [ ] text`,
 * continuation lines indented by 4 spaces or a tab), an optional
 * `**Complete**` paragraph under a lane heading, an archive (`***` followed by
 * `## Archive`) and a trailing `%% kanban:settings` block with JSON settings.
 *
 * The model keeps the source lines of everything it does not edit, so
 * `serializeBoard(parseBoard(md)) === md` for any input and an edit only
 * rewrites the lines of the cards, lanes and settings it touches.
 */
import { parseYamlObject } from 'common/markdownExt'

export const FRONT_MATTER_KEY = 'kanban-plugin'

/**
 * Words Obsidian Kanban writes for the complete marker and the archive
 * heading. They are localized there (`t('Complete')`, `t('Archive')`), so a
 * board written by a Portuguese Obsidian uses the Portuguese words.
 */
export interface BoardMarkers {
  complete: string
  archive: string
}

export const ENGLISH_MARKERS: BoardMarkers = { complete: 'Complete', archive: 'Archive' }
export const PORTUGUESE_MARKERS: BoardMarkers = { complete: 'Concluído', archive: 'Arquivado' }
export const KNOWN_MARKERS = [ENGLISH_MARKERS, PORTUGUESE_MARKERS]

/** Markers for new boards and new archives, following the app UI language. */
export const getMarkersForLanguage = (language: string): BoardMarkers =>
  language === 'pt' || language.startsWith('pt-') ? PORTUGUESE_MARKERS : ENGLISH_MARKERS

export interface KanbanCard {
  /** Runtime identity for the UI; not written to the file. */
  id: string
  /** List marker with its trailing whitespace, e.g. `- ` or `1. `. */
  marker: string
  /** Character between the brackets (' ' when open), or null for a list item without checkbox. */
  checkChar: string | null
  /** Card markdown: continuation indentation removed, `<br>` turned into line breaks, block id excluded. */
  text: string
  /** Obsidian block id (`^abc123`) at the end of the first line, without `^`. */
  blockId: string | null
  /** Source lines while the text is unchanged; null after an edit (regenerated from `text`). */
  lines: string[] | null
  /** Blank lines separating this card from the previous one (loose lists); always empty for the first card. */
  gap: string[]
}

export interface KanbanLane {
  id: string
  title: string
  /** WIP limit from `## Title (3)`; 0 when there is none. */
  maxItems: number
  /** Number of `#` of the heading. */
  level: number
  /** Source heading line while title and limit are unchanged; null after a rename. */
  headingLine: string | null
  /** Lines between the heading and the first card: blank lines, the complete marker, other content. */
  head: string[]
  cards: KanbanCard[]
  /** Lines after the last card up to the next section. */
  tail: string[]
  /** The source had no blank line before the heading; serialization only adds one where this is false. */
  tight: boolean
}

export interface KanbanArchive extends KanbanLane {
  /** The thematic break (`***`) and the lines between it and the archive heading. */
  separator: string[]
}

export interface KanbanBoard {
  eol: '\n' | '\r\n'
  finalNewline: boolean
  /** Lines before the first lane: front matter and anything else. */
  preamble: string[]
  lanes: KanbanLane[]
  archive: KanbanArchive | null
  /** Number of lanes written before the archive (lanes after it are kept where they were). */
  lanesBeforeArchive: number
  /** `%% kanban:settings` block through the end of the file; empty when absent. */
  footer: string[]
  footerTight: boolean
  /** Parsed settings JSON of the footer; {} when absent or invalid. */
  settings: Record<string, unknown>
  /** Whether `settings` came from valid JSON that serialization may rewrite. */
  settingsEditable: boolean
  /** Continuation indent for regenerated multi-line cards. */
  indent: string
}

let nextId = 0
export const createId = (prefix: string): string => `${prefix}-${(++nextId).toString(36)}`

const BLANK = /^[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const LIST_ITEM = /^( {0,3}(?:[-*+]|\d{1,9}[.)]))([ \t]+|$)/
const CHECKBOX = /^\[(.)\](?=[ \t]|$)[ \t]?/
const BLOCK_ID = /\s+\^([a-zA-Z0-9-]+)$/
const SETTINGS_START = /^%% kanban:settings[ \t]*$/
// Block starts that end a card paragraph instead of continuing it lazily.
const INTERRUPT = /^ {0,3}(?:>|`{3,}|~{3,}|<[a-zA-Z/!?])/

const isBlank = (line: string): boolean => BLANK.test(line)

/** Column width of the leading whitespace (tabs to the next multiple of 4). */
const indentWidth = (line: string): number => {
  let width = 0
  for (const char of line) {
    if (char === ' ') width++
    else if (char === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

const isListItem = (line: string): boolean => LIST_ITEM.test(line) && !THEMATIC_BREAK.test(line)

/** Heading text as Obsidian reads it: trimmed, closing `#` sequence removed. */
const headingContent = (rest: string): string => rest.trim().replace(/(?:^|[ \t]+)#+$/, '').trim()

const markerText = (line: string): string =>
  line.trim().replace(/^(\*\*|__)(.*)\1$/, '$2')

export const isCompleteLine = (line: string): boolean => {
  const text = markerText(line)
  return KNOWN_MARKERS.some((markers) => markers.complete === text)
}

/** `Title (3)` → title and WIP limit; `<br>` stands for a line break in Obsidian lane titles. */
export const parseLaneTitle = (raw: string): { title: string; maxItems: number } => {
  const text = raw.replace(/<br\s*\/?>/gi, '\n').trim()
  const match = /^(.*?)\s*\((\d+)\)$/s.exec(text)
  if (!match) return { title: text, maxItems: 0 }
  return { title: match[1], maxItems: Number(match[2]) }
}

export const formatLaneHeading = (level: number, title: string, maxItems: number): string => {
  const text = title.trim().replace(/\r?\n/g, '<br>')
  return `${'#'.repeat(level)} ${text}${maxItems > 0 ? ` (${maxItems})` : ''}`
}

const stripIndent = (line: string, width: number): string => {
  if (line.startsWith('\t')) return line.slice(1)
  let index = 0
  while (index < width && line[index] === ' ') index++
  return line.slice(index)
}

/** Card text of a list item's source lines (first line already without marker and checkbox). */
const cardText = (first: string, continuation: string[]): { text: string; blockId: string | null } => {
  const indented = continuation.filter((line) => !isBlank(line) && indentWidth(line) > 0)
  const width = Math.min(4, ...indented.map(indentWidth))
  const lines = [first.trim(), ...continuation.map((line) => (isBlank(line) ? '' : stripIndent(line, width)))]
  let text = lines.join('\n').replace(/<br\s*\/?>/gi, '\n').trim()
  let blockId: string | null = null
  const newline = text.indexOf('\n')
  const firstLine = newline === -1 ? text : text.slice(0, newline)
  const block = BLOCK_ID.exec(firstLine)
  if (block) {
    blockId = block[1]
    text = firstLine.slice(0, block.index) + (newline === -1 ? '' : text.slice(newline))
  }
  return { text, blockId }
}

const parseCard = (lines: string[], gap: string[]): KanbanCard => {
  const item = LIST_ITEM.exec(lines[0])
  // Callers only pass lines starting with a list item.
  const marker = item ? item[1].trimStart() + (item[2] || ' ') : '- '
  let rest = item ? lines[0].slice(item[0].length) : lines[0]
  let checkChar: string | null = null
  const checkbox = CHECKBOX.exec(rest)
  if (checkbox) {
    checkChar = checkbox[1]
    rest = rest.slice(checkbox[0].length)
  }
  const { text, blockId } = cardText(rest, lines.slice(1))
  return { id: createId('card'), marker, checkChar, text, blockId, lines, gap }
}

/** Splits a lane body into head, cards and tail (see KanbanLane). */
const parseLaneBody = (body: string[]): Pick<KanbanLane, 'head' | 'cards' | 'tail'> => {
  let start = -1
  let fence: string | null = null
  for (let i = 0; i < body.length; i++) {
    const line = body[i]
    const open = FENCE.exec(line)
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1].trim()) fence = null
      continue
    }
    if (open) {
      fence = open[1]
      continue
    }
    if (isListItem(line)) {
      start = i
      break
    }
  }

  if (start === -1) {
    // Empty lane: keep one blank line after the content in `head` so a first
    // card lands where Obsidian puts it; further blank lines separate lanes.
    let lastContent = -1
    for (let i = body.length - 1; i >= 0; i--) {
      if (!isBlank(body[i])) {
        lastContent = i
        break
      }
    }
    const split = Math.min(body.length, lastContent + 2)
    return { head: body.slice(0, split), cards: [], tail: body.slice(split) }
  }

  const cards: KanbanCard[] = []
  let current = [body[start]]
  let contentIndent = indentWidth(body[start]) + (LIST_ITEM.exec(body[start])?.[0].trimStart().length ?? 2)
  let gap: string[] = []
  let pending: string[] = []
  let end = body.length
  for (let i = start + 1; i < body.length; i++) {
    const line = body[i]
    if (isBlank(line)) {
      pending.push(line)
      continue
    }
    const indent = indentWidth(line)
    if (indent >= contentIndent) {
      current.push(...pending, line)
      pending = []
      continue
    }
    if (isListItem(line)) {
      cards.push(parseCard(current, gap))
      gap = pending
      pending = []
      current = [line]
      contentIndent = indent + (LIST_ITEM.exec(line)?.[0].trimStart().length ?? 2)
      continue
    }
    if (pending.length === 0 && !THEMATIC_BREAK.test(line) && !INTERRUPT.test(line)) {
      // Lazy continuation of the card's paragraph.
      current.push(line)
      continue
    }
    end = i - pending.length
    break
  }
  cards.push(parseCard(current, gap))
  if (end === body.length) end -= pending.length
  return { head: body.slice(0, start), cards, tail: body.slice(end) }
}

const headingIndexes = (lines: string[], from: number): number[] => {
  const indexes: number[] = []
  let fence: string | null = null
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]
    const open = FENCE.exec(line)
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1].trim()) fence = null
      continue
    }
    if (open) {
      fence = open[1]
      continue
    }
    if (HEADING.test(line)) indexes.push(i)
  }
  return indexes
}

const frontMatterEnd = (lines: string[]): number => {
  if (lines[0] !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') return i + 1
  }
  return 0
}

const parseSettings = (footer: string[]): { settings: Record<string, unknown>; editable: boolean } => {
  const open = footer.findIndex((line) => /^```/.test(line))
  if (open === -1) return { settings: {}, editable: false }
  const close = footer.findIndex((line, index) => index > open && /^```/.test(line))
  if (close === -1) return { settings: {}, editable: false }
  try {
    const value: unknown = JSON.parse(footer.slice(open + 1, close).join('\n'))
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { settings: value as Record<string, unknown>, editable: true }
    }
  } catch {
    // An invalid settings block is kept verbatim.
  }
  return { settings: {}, editable: false }
}

const detectIndent = (lanes: KanbanLane[]): string => {
  for (const lane of lanes) {
    for (const card of lane.cards) {
      const line = card.lines?.slice(1).find((entry) => !isBlank(entry))
      if (line?.startsWith('\t')) return '\t'
      if (line?.startsWith(' ')) return '    '
    }
  }
  return '    '
}

const isTight = (lines: string[], index: number): boolean => index > 0 && !isBlank(lines[index - 1])

export const parseBoard = (markdown: string): KanbanBoard => {
  const eol = /\r\n/.test(markdown.slice(0, markdown.indexOf('\n') + 1)) ? '\r\n' : '\n'
  const lines = markdown === '' ? [] : markdown.split(/\r?\n/)
  const finalNewline = lines.length > 0 && lines[lines.length - 1] === ''
  if (finalNewline) lines.pop()

  let footerStart = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SETTINGS_START.test(lines[i])) {
      footerStart = i
      break
    }
  }
  const footer = lines.slice(footerStart)
  const { settings, editable } = parseSettings(footer)
  const body = lines.slice(0, footerStart)

  const headings = headingIndexes(body, frontMatterEnd(body))
  const sectionEnds = headings.map((_, k) => (k + 1 < headings.length ? headings[k + 1] : body.length))

  let archiveIndex = -1
  let archiveSeparatorStart = -1
  for (let k = 0; k < headings.length && archiveIndex === -1; k++) {
    const match = HEADING.exec(body[headings[k]])
    const text = match ? markerText(headingContent(match[2])) : ''
    if (!KNOWN_MARKERS.some((markers) => markers.archive === text)) continue
    let prev = headings[k] - 1
    while (prev >= 0 && isBlank(body[prev])) prev--
    if (prev >= 0 && THEMATIC_BREAK.test(body[prev]) && prev >= frontMatterEnd(body)) {
      archiveIndex = k
      archiveSeparatorStart = prev
      if (k > 0) sectionEnds[k - 1] = prev
    }
  }

  const preambleEnd = headings.length > 0 ? headings[0] : body.length
  const preamble = body.slice(0, archiveIndex === 0 ? archiveSeparatorStart : preambleEnd)

  const lanes: KanbanLane[] = []
  let archive: KanbanArchive | null = null
  let lanesBeforeArchive = 0
  headings.forEach((index, k) => {
    const match = HEADING.exec(body[index])
    const { title, maxItems } = parseLaneTitle(match ? headingContent(match[2]) : '')
    const lane: KanbanLane = {
      id: createId('lane'),
      title,
      maxItems,
      level: match ? match[1].length : 2,
      headingLine: body[index],
      ...parseLaneBody(body.slice(index + 1, sectionEnds[k])),
      tight: isTight(body, index)
    }
    if (k === archiveIndex) {
      archive = {
        ...lane,
        separator: body.slice(archiveSeparatorStart, index),
        tight: isTight(body, archiveSeparatorStart)
      }
      lanesBeforeArchive = lanes.length
    } else {
      lanes.push(lane)
    }
  })
  if (archiveIndex === -1) lanesBeforeArchive = lanes.length

  return {
    eol,
    finalNewline,
    preamble,
    lanes,
    archive,
    lanesBeforeArchive,
    footer,
    footerTight: isTight(lines, footerStart),
    settings,
    settingsEditable: editable,
    indent: detectIndent(lanes)
  }
}

/** Source lines of a card: the parsed lines, or lines generated the way Obsidian Kanban writes them. */
export const cardLines = (card: KanbanCard, indent: string): string[] => {
  if (card.lines) return card.lines
  const [first, ...rest] = card.text.trim().split('\n')
  const checkbox = card.checkChar === null ? '' : `[${card.checkChar}] `
  const blockId = card.blockId ? ` ^${card.blockId}` : ''
  return [`${card.marker}${checkbox}${first}${blockId}`, ...rest.map((line) => indent + line)]
}

const laneLines = (lane: KanbanLane, indent: string): string[] => [
  lane.headingLine ?? formatLaneHeading(lane.level, lane.title, lane.maxItems),
  ...lane.head,
  ...lane.cards.flatMap((card, index) => [...(index === 0 ? [] : card.gap), ...cardLines(card, indent)]),
  ...lane.tail
]

export const serializeBoard = (board: KanbanBoard): string => {
  const out: string[] = [...board.preamble]
  const append = (lines: string[], tight: boolean): void => {
    if (!tight && out.length > 0 && !isBlank(out[out.length - 1]) && lines.length > 0 && !isBlank(lines[0])) {
      out.push('')
    }
    out.push(...lines)
  }
  const appendArchive = (): void => {
    const archive = board.archive
    if (!archive) return
    append(archive.separator, archive.tight)
    out.push(...laneLines(archive, board.indent))
  }

  board.lanes.forEach((lane, index) => {
    if (index === board.lanesBeforeArchive) appendArchive()
    append(laneLines(lane, board.indent), lane.tight)
  })
  if (board.lanesBeforeArchive >= board.lanes.length) appendArchive()
  append(board.footer, board.footerTight)

  return out.join(board.eol) + (board.finalNewline ? board.eol : '')
}

// Obsidian also accepts front matter directly followed by content, which
// common/markdownExt's muya-compatible extractor does not.
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

/** Whether `markdown` declares a Kanban board in its front matter (`kanban-plugin: board`, or the older `basic`). */
export const isKanbanMarkdown = (markdown: string): boolean => {
  const match = FRONT_MATTER.exec(markdown)
  if (!match) return false
  const value = parseYamlObject(match[1])?.[FRONT_MATTER_KEY]
  return typeof value === 'string' && value.trim() !== ''
}
