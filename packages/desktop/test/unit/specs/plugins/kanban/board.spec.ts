import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isKanbanMarkdown, parseBoard, parseLaneTitle, serializeBoard } from '@plugins/kanban/common/board'
import { isCardChecked, isCompleteLane } from '@plugins/kanban/common/operations'

const FIXTURE = readFileSync(resolve(__dirname, '../../../../fixtures/vault/Projects/Kanban Board.md'), 'utf8')

// Exactly what Obsidian Kanban's boardToMd writes (tab indentation is Obsidian's default).
const OBSIDIAN_BOARD = [
  '---',
  '',
  'kanban-plugin: board',
  '',
  '---',
  '',
  '## To do (3)',
  '',
  '- [ ] First card',
  '- [ ] Multi ^abc123',
  '\tline card',
  '\t',
  '\tsecond paragraph',
  '- [ ] Due @{2026-10-04} @@{09:30} [[Note]]',
  '',
  '',
  '',
  '## Empty',
  '',
  '',
  '',
  '',
  '## Done',
  '',
  '**Complete**',
  '- [x] Finished',
  '',
  '',
  '',
  '***',
  '',
  '## Archive',
  '',
  '- [x] Archived one',
  '',
  '%% kanban:settings',
  '```',
  '{"kanban-plugin":"board","list-collapse":[false,true,false]}',
  '```',
  '%%'
].join('\n')

const UNKNOWN_CONTENT = `---
kanban-plugin: basic
tags: [work]
---

Intro paragraph kept before the lanes.

# Ideas

Notes about this lane.

* [ ] Star bullet card
+ Plain list item without checkbox
1. [x] Ordered card

> A quote after the list

\`\`\`
## not a lane
- [ ] not a card
\`\`\`

<!-- html comment -->
## Next
- [ ] Tight card
lazy continuation
- [ ] Loose card

- [ ] After a blank line
`

describe('Kanban board parser', () => {
  it('reads the fixture board', () => {
    const board = parseBoard(FIXTURE)
    expect(board.lanes.map((lane) => lane.title)).toEqual(['Todo', 'Doing', 'Done'])
    expect(board.lanes[0].cards.map((card) => card.text)).toEqual(['Prepare demo [[Alpha]]', 'Write release notes #release'])
    expect(board.lanes.map(isCompleteLane)).toEqual([false, false, true])
    expect(isCardChecked(board.lanes[2].cards[0])).toBe(true)
    expect(board.archive?.cards.map((card) => card.text)).toEqual(['Old card'])
    expect(board.settings).toEqual({ 'kanban-plugin': 'board', 'list-collapse': [false, false, false] })
  })

  it.each([
    ['fixture', FIXTURE],
    ['Obsidian output', OBSIDIAN_BOARD],
    ['unknown content', UNKNOWN_CONTENT],
    ['CRLF', FIXTURE.replace(/\n/g, '\r\n')],
    ['no trailing newline', FIXTURE.trimEnd()],
    ['empty', ''],
    ['front matter only', '---\nkanban-plugin: board\n---\n'],
    ['invalid settings', '## A\n\n- [ ] a\n\n%% kanban:settings\n```\n{oops\n```\n%%\n']
  ])('serializes an unmodified board byte for byte (%s)', (_name, markdown) => {
    expect(serializeBoard(parseBoard(markdown))).toBe(markdown)
  })

  it('reads lanes, WIP limits, multi-line cards and block ids of an Obsidian board', () => {
    const board = parseBoard(OBSIDIAN_BOARD)
    expect(board.lanes.map((lane) => [lane.title, lane.maxItems])).toEqual([
      ['To do', 3],
      ['Empty', 0],
      ['Done', 0]
    ])
    const [first, multi, due] = board.lanes[0].cards
    expect(first.text).toBe('First card')
    expect(multi.text).toBe('Multi\nline card\n\nsecond paragraph')
    expect(multi.blockId).toBe('abc123')
    expect(due.text).toBe('Due @{2026-10-04} @@{09:30} [[Note]]')
    expect(board.lanes[1].cards).toEqual([])
    expect(isCompleteLane(board.lanes[2])).toBe(true)
    expect(board.archive?.cards.map((card) => card.text)).toEqual(['Archived one'])
    expect(board.indent).toBe('\t')
  })

  it('keeps unknown content out of cards', () => {
    const board = parseBoard(UNKNOWN_CONTENT)
    expect(board.preamble.join('\n')).toContain('Intro paragraph kept before the lanes.')
    expect(board.lanes.map((lane) => lane.title)).toEqual(['Ideas', 'Next'])
    const [ideas, next] = board.lanes
    expect(ideas.head).toEqual(['', 'Notes about this lane.', ''])
    expect(ideas.cards.map((card) => [card.marker, card.checkChar, card.text])).toEqual([
      ['* ', ' ', 'Star bullet card'],
      ['+ ', null, 'Plain list item without checkbox'],
      ['1. ', 'x', 'Ordered card']
    ])
    expect(ideas.tail.join('\n')).toContain('## not a lane')
    expect(ideas.tail.join('\n')).toContain('<!-- html comment -->')
    expect(next.cards.map((card) => card.text)).toEqual(['Tight card\nlazy continuation', 'Loose card', 'After a blank line'])
    expect(next.cards[2].gap).toEqual([''])
  })

  it('treats a heading named Archive as a lane unless a thematic break precedes it', () => {
    const board = parseBoard('## Archive\n\n- [ ] still a lane\n')
    expect(board.archive).toBeNull()
    expect(board.lanes.map((lane) => lane.title)).toEqual(['Archive'])
  })

  it('recognises the markers Obsidian writes in Portuguese', () => {
    const board = parseBoard('## Feito\n\n**Concluído**\n\n- [x] a\n\n***\n\n## Arquivado\n\n- [x] b\n')
    expect(isCompleteLane(board.lanes[0])).toBe(true)
    expect(board.archive?.cards.map((card) => card.text)).toEqual(['b'])
  })

  it('keeps CRLF line endings', () => {
    const board = parseBoard('## A\r\n\r\n- [ ] a\r\n')
    expect(board.eol).toBe('\r\n')
    expect(board.lanes[0].cards[0].text).toBe('a')
  })

  it('parses lane titles with WIP limits and line breaks', () => {
    expect(parseLaneTitle('Doing (5)')).toEqual({ title: 'Doing', maxItems: 5 })
    expect(parseLaneTitle('Two<br>lines')).toEqual({ title: 'Two\nlines', maxItems: 0 })
    expect(parseLaneTitle('Year (2026) plan')).toEqual({ title: 'Year (2026) plan', maxItems: 0 })
  })
})

describe('isKanbanMarkdown', () => {
  it.each([
    ['---\nkanban-plugin: board\n---\n\n## A\n', true],
    ['---\n\nkanban-plugin: basic\n\n---\n', true],
    ['---\r\nkanban-plugin: board\r\n---\r\n## A\r\n', true],
    ['---\ntitle: Notes\n---\n\n## A\n', false],
    ['kanban-plugin: board\n', false],
    ['---\nkanban-plugin: [\n---\n', false],
    ['', false]
  ])('%j → %s', (markdown, expected) => {
    expect(isKanbanMarkdown(markdown)).toBe(expected)
  })
})
