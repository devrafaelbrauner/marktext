import { describe, expect, it } from 'vitest'
import { isKanbanMarkdown, parseBoard, serializeBoard, ENGLISH_MARKERS, PORTUGUESE_MARKERS } from '@plugins/kanban/common/board'
import { findCardTokens, getTriggers, parseIsoDate } from '@plugins/kanban/common/cardText'
import { matchObsidianComment } from '@plugins/kanban/common/comment'
import { createBoardMarkdown, toBoardFileName } from '@plugins/kanban/common/newBoard'
import { isCompleteLane } from '@plugins/kanban/common/operations'
import { renderCardContent } from '@plugins/kanban/renderer/renderCard'

const TRIGGERS = getTriggers({})

const tokens = (text: string, triggers = TRIGGERS) =>
  findCardTokens(text, triggers).map(({ start, end, token }) => ({ raw: text.slice(start, end), type: token.type }))

describe('card tokens', () => {
  it('finds wikilinks, tags, dates and times', () => {
    expect(tokens('Call [[Bob|him]] #work @{2026-10-04} @@{09:30} @[[2026-10-05]]')).toEqual([
      { raw: '[[Bob|him]]', type: 'wikilink' },
      { raw: '#work', type: 'tag' },
      { raw: '@{2026-10-04}', type: 'date' },
      { raw: '@@{09:30}', type: 'time' },
      { raw: '@[[2026-10-05]]', type: 'date' }
    ])
  })

  it('skips code spans, link destinations, URLs and HTML', () => {
    expect(tokens('`#no [[no]]` [x](note.md#no) https://a.b/#no <a href="#no"> ok #yes')).toEqual([
      { raw: '#yes', type: 'tag' }
    ])
  })

  it('ignores hex colours, numbers and incomplete dates', () => {
    expect(tokens('#fff #2026 @{} @{open')).toEqual([])
  })

  it('uses the board triggers', () => {
    const triggers = getTriggers({ 'date-trigger': '!', 'time-trigger': '!!' })
    expect(tokens('!{2026-01-02} !!{8:00} @{2026-01-02}', triggers)).toEqual([
      { raw: '!{2026-01-02}', type: 'date' },
      { raw: '!!{8:00}', type: 'time' }
    ])
  })

  it('parses ISO dates only', () => {
    expect(parseIsoDate('2026-10-04')?.getDate()).toBe(4)
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('04/10/2026')).toBeNull()
  })
})

describe('card rendering', () => {
  const render = (text: string, checked = false): HTMLElement => {
    const container = document.createElement('div')
    renderCardContent(container, text, {
      triggers: TRIGGERS,
      locale: 'en-US',
      checked,
      today: new Date(2026, 9, 4),
      overdueLabel: 'Overdue'
    })
    return container
  }

  it('renders markdown with wikilinks, tags and chips', () => {
    const container = render('**Ship** [[Alpha#Plan|the plan]] #release @{2026-10-01} @@{10:30}')
    expect(container.querySelector('strong')?.textContent).toBe('Ship')
    const link = container.querySelector<HTMLAnchorElement>('a.kanban-wikilink')!
    expect(link.textContent).toBe('the plan')
    expect(link.dataset.raw).toBe('[[Alpha#Plan|the plan]]')
    expect(container.querySelector('.kanban-tag')?.textContent).toBe('#release')
    const date = container.querySelector('.kanban-date')!
    expect(date.textContent?.trim()).toBe('Oct 1, 2026')
    expect(date.classList.contains('is-overdue')).toBe(true)
    expect(container.querySelector('.kanban-time')?.textContent?.trim()).toBe('10:30')
  })

  it('does not mark dates of complete cards or future dates as overdue', () => {
    expect(render('@{2026-10-01}', true).querySelector('.is-overdue')).toBeNull()
    expect(render('@{2026-10-04}').querySelector('.is-overdue')).toBeNull()
  })

  it('keeps line breaks and leaves code untouched', () => {
    const container = render('first\nsecond `[[x]]`')
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('[[x]]')
    expect(container.querySelector('.kanban-wikilink')).toBeNull()
  })

  it('escapes user content', () => {
    const container = render('<img src=x onerror="alert(1)"> [[<b>x</b>]] #<script>')
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('.kanban-wikilink b')).toBeNull()
  })
})

describe('Obsidian comments', () => {
  it.each([
    ['%% hidden %% after', '', 12],
    ['%%a%%', 'x', 5],
    ['%% kanban:settings', '', 18],
    ['%%', '', 2],
    ['%% open comment', 'x', null],
    ['%%no space', '', null],
    ['50% off', '', null]
  ])('%j (prev %j) → %s', (src, prev, expected) => {
    expect(matchObsidianComment(src, prev)).toBe(expected)
  })
})

describe('new boards', () => {
  it('creates a board in the layout MarkText writes', () => {
    const markdown = createBoardMarkdown(['A fazer', 'Fazendo', 'Concluído'], PORTUGUESE_MARKERS)
    expect(markdown).toBe(
      '---\nkanban-plugin: board\n---\n\n## A fazer\n\n## Fazendo\n\n## Concluído\n\n**Concluído**\n\n' +
        '%% kanban:settings\n\n```\n{"kanban-plugin":"board"}\n```\n\n%%\n'
    )
    expect(isKanbanMarkdown(markdown)).toBe(true)
    const board = parseBoard(markdown)
    expect(board.lanes.map((lane) => [lane.title, isCompleteLane(lane)])).toEqual([
      ['A fazer', false],
      ['Fazendo', false],
      ['Concluído', true]
    ])
    expect(serializeBoard(board)).toBe(markdown)
  })

  it('uses the English marker for English boards', () => {
    expect(createBoardMarkdown(['Done'], ENGLISH_MARKERS)).toContain('## Done\n\n**Complete**\n')
  })

  it.each([
    ['Sprint 1', 'Sprint 1.md'],
    ['  Plano: Q4/2026  ', 'Plano Q4 2026.md'],
    ['board.md', 'board.md'],
    ['..', 'Kanban.md'],
    ['', 'Kanban.md']
  ])('file name of %j is %j', (name, expected) => {
    expect(toBoardFileName(name)).toBe(expected)
  })
})
