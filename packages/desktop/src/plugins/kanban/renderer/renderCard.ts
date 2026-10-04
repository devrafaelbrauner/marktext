import { renderToStaticHTML } from '@muyajs/core'
import { Calendar, Clock } from 'lucide-static'
import { findCardTokens, parseIsoDate, type CardToken, type CardTriggers } from '../common/cardText'

export interface CardRenderOptions {
  triggers: CardTriggers
  /** BCP 47 locale for date chips. */
  locale: string
  /** Checked cards never show dates as overdue. */
  checked: boolean
  /** Start of today, for overdue dates. */
  today: Date
  overdueLabel: string
}

// Private-use characters stand in for tokens while the markdown renders, so no
// markdown or inline-syntax rule can match inside them.
const OPEN = '\uE000'
const CLOSE = '\uE001'
const PLACEHOLDER = /\uE000(\d+)\uE001/g

/** Soft line breaks become hard breaks outside fenced code, as cards show their lines like Obsidian Kanban. */
const withHardBreaks = (markdown: string): string => {
  let fence: string | null = null
  const lines = markdown.split('\n')
  return lines
    .map((line, index) => {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence) {
        if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null
        return line
      }
      if (open) {
        fence = open[1]
        return line
      }
      const next = lines[index + 1]
      return next !== undefined && next.trim() !== '' && line.trim() !== '' ? `${line}  ` : line
    })
    .join('\n')
}

const formatDate = (value: string, locale: string): string => {
  const date = parseIsoDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

const icon = (svg: string): HTMLElement => {
  const span = document.createElement('span')
  span.className = 'kanban-chip-icon'
  span.setAttribute('aria-hidden', 'true')
  // Static icon markup shipped with the app, not user content.
  span.innerHTML = svg
  return span
}

const createTokenElement = (token: CardToken, raw: string, options: CardRenderOptions): HTMLElement => {
  switch (token.type) {
    case 'wikilink': {
      const link = token.link
      const a = document.createElement('a')
      a.className = 'kanban-wikilink'
      a.href = '#'
      a.dataset.raw = raw
      const label = link.target + (link.heading ? ` > ${link.heading}` : '') + (link.subpath ? `#${link.subpath}` : '')
      a.textContent = link.alias ?? (label || raw)
      a.title = raw
      return a
    }
    case 'tag': {
      const span = document.createElement('span')
      span.className = 'kanban-tag'
      span.dataset.tag = token.tag
      span.textContent = `#${token.tag}`
      return span
    }
    case 'date': {
      const element = document.createElement(token.link ? 'a' : 'span')
      element.className = 'kanban-chip kanban-date'
      if (token.link && element instanceof HTMLAnchorElement) {
        element.href = '#'
        element.classList.add('kanban-wikilink')
        element.dataset.raw = raw.slice(raw.indexOf('[['))
      }
      const date = parseIsoDate(token.date)
      if (date && !options.checked && date < options.today) {
        element.classList.add('is-overdue')
        element.title = options.overdueLabel
      }
      if (date) element.dataset.date = token.date
      element.append(icon(Calendar), document.createTextNode(formatDate(token.date, options.locale)))
      return element
    }
    case 'time': {
      const span = document.createElement('span')
      span.className = 'kanban-chip kanban-time'
      span.append(icon(Clock), document.createTextNode(token.time))
      return span
    }
  }
}

/**
 * Renders card markdown into `container`: sanitized HTML from the editor's
 * static renderer, with wikilinks as `a.kanban-wikilink` (`data-raw` holds the
 * link source), tags as `span.kanban-tag` and date/time chips.
 */
export const renderCardContent = (container: HTMLElement, text: string, options: CardRenderOptions): void => {
  const tokens = findCardTokens(text, options.triggers)
  let source = ''
  let last = 0
  tokens.forEach((match, index) => {
    source += text.slice(last, match.start) + OPEN + index + CLOSE
    last = match.end
  })
  source += text.slice(last)

  container.innerHTML = renderToStaticHTML(withHardBreaks(source))

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.data.includes(OPEN)) textNodes.push(node)
  }
  for (const node of textNodes) {
    const fragment = document.createDocumentFragment()
    let offset = 0
    for (const match of node.data.matchAll(PLACEHOLDER)) {
      const tokenMatch = tokens[Number(match[1])]
      fragment.append(node.data.slice(offset, match.index))
      fragment.append(
        tokenMatch
          ? createTokenElement(tokenMatch.token, text.slice(tokenMatch.start, tokenMatch.end), options)
          : match[0]
      )
      offset = match.index + match[0].length
    }
    fragment.append(node.data.slice(offset))
    node.replaceWith(fragment)
  }
}
