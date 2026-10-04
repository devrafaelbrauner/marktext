import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ENGLISH_MARKERS,
  PORTUGUESE_MARKERS,
  parseBoard,
  serializeBoard,
  type KanbanBoard
} from '@plugins/kanban/common/board'
import {
  addCard,
  addLane,
  archiveCard,
  deleteArchivedCard,
  deleteCard,
  deleteLane,
  getBoardMarkers,
  moveCard,
  moveLane,
  renameLane,
  restoreArchivedCard,
  setCardChecked,
  setLaneComplete,
  updateCardText
} from '@plugins/kanban/common/operations'

const FIXTURE = readFileSync(resolve(__dirname, '../../../../fixtures/vault/Projects/Kanban Board.md'), 'utf8')

const edit = (markdown: string, change: (board: KanbanBoard) => void): string => {
  const board = parseBoard(markdown)
  change(board)
  return serializeBoard(board)
}

const SETTINGS = (collapse: string): string =>
  `%% kanban:settings\n\n\`\`\`\n{"kanban-plugin":"board","list-collapse":[${collapse}]}\n\`\`\`\n\n%%\n`

const SIMPLE = `---
kanban-plugin: board
---

## A

- [ ] one
- [ ] two

## B

- [ ] three
`

describe('Kanban board operations', () => {
  it('moves a card into a complete lane and checks it', () => {
    expect(edit(FIXTURE, (board) => moveCard(board, 1, 0, 2, 1))).toBe(`---
kanban-plugin: board
---

## Todo

- [ ] Prepare demo [[Alpha]]
- [ ] Write release notes #release

## Doing

## Done

**Complete**

- [x] Set up the repository
- [x] Fix the importer

***

## Archive

- [x] Old card

${SETTINGS('false,false,false')}`)
  })

  it('unchecks a card leaving a complete lane and fills an empty lane', () => {
    const markdown = edit(FIXTURE, (board) => {
      moveCard(board, 1, 0, 0, 0)
      moveCard(board, 2, 0, 1, 0)
    })
    expect(markdown).toContain(`## Todo

- [ ] Fix the importer
- [ ] Prepare demo [[Alpha]]
- [ ] Write release notes #release

## Doing

- [ ] Set up the repository

## Done

**Complete**

***`)
  })

  it('reorders cards within a lane', () => {
    expect(edit(SIMPLE, (board) => moveCard(board, 0, 0, 0, 1))).toBe(SIMPLE.replace('- [ ] one\n- [ ] two', '- [ ] two\n- [ ] one'))
  })

  it('changes only the checkbox character when toggling', () => {
    const markdown = '## A\n\n* [ ]  spaced   card ^id1\n'
    expect(edit(markdown, (board) => setCardChecked(board, 0, 0, true))).toBe('## A\n\n* [x]  spaced   card ^id1\n')
  })

  it('adds a checkbox to a plain list item when it gets checked', () => {
    expect(edit('## A\n\n- plain\n', (board) => setCardChecked(board, 0, 0, true))).toBe('## A\n\n- [x] plain\n')
  })

  it('rewrites an edited multi-line card with the board indentation and keeps its block id', () => {
    const markdown = '## A\n\n- [ ] Multi ^abc\n\tline\n- [ ] other\n'
    expect(edit(markdown, (board) => updateCardText(board, 0, 0, 'New\nlines\n\nhere'))).toBe(
      '## A\n\n- [ ] New ^abc\n\tlines\n\t\n\there\n- [ ] other\n'
    )
    expect(edit(SIMPLE, (board) => updateCardText(board, 0, 1, 'two\nmore'))).toContain('- [ ] two\n    more\n')
  })

  it('keeps the source when an edit does not change the text', () => {
    const markdown = '## A\n\n- [ ] a <br> b\n'
    expect(edit(markdown, (board) => updateCardText(board, 0, 0, 'a \n b'))).toBe(markdown)
  })

  it('adds cards at the end or the top, checked in a complete lane', () => {
    expect(edit(SIMPLE, (board) => addCard(board, 1, 'four'))).toBe(SIMPLE.replace('- [ ] three\n', '- [ ] three\n- [ ] four\n'))
    expect(edit(SIMPLE, (board) => addCard(board, 0, 'zero', 'start'))).toContain('## A\n\n- [ ] zero\n- [ ] one\n')
    expect(edit(FIXTURE, (board) => addCard(board, 2, 'Shipped'))).toContain('- [x] Set up the repository\n- [x] Shipped\n')
  })

  it('keeps a loose list loose', () => {
    const markdown = '## A\n\n- [ ] one\n\n- [ ] two\n'
    expect(edit(markdown, (board) => addCard(board, 0, 'three'))).toBe('## A\n\n- [ ] one\n\n- [ ] two\n\n- [ ] three\n')
  })

  it('deletes cards', () => {
    expect(edit(SIMPLE, (board) => deleteCard(board, 0, 0))).toBe(SIMPLE.replace('- [ ] one\n', ''))
  })

  it('creates the archive after the lanes on the first archived card', () => {
    expect(edit(SIMPLE, (board) => archiveCard(board, 0, 1, ENGLISH_MARKERS))).toBe(`---
kanban-plugin: board
---

## A

- [ ] one

## B

- [ ] three

***

## Archive

- [ ] two
`)
  })

  it('appends to an existing archive and restores from it', () => {
    const archived = edit(FIXTURE, (board) => archiveCard(board, 0, 0, PORTUGUESE_MARKERS))
    expect(archived).toContain('## Archive\n\n- [x] Old card\n- [ ] Prepare demo [[Alpha]]\n\n%% kanban:settings')
    expect(edit(archived, (board) => restoreArchivedCard(board, 1, 2))).toContain(
      '- [x] Set up the repository\n- [x] Prepare demo [[Alpha]]\n'
    )
    expect(edit(archived, (board) => deleteArchivedCard(board, 0))).toContain('## Archive\n\n- [ ] Prepare demo [[Alpha]]\n')
  })

  it('adds a lane before the archive and keeps list-collapse in step', () => {
    expect(edit(FIXTURE, (board) => addLane(board, 'Review'))).toBe(
      FIXTURE.replace('***', '## Review\n\n***').replace('[false,false,false]', '[false,false,false,false]')
    )
    expect(edit(SIMPLE, (board) => addLane(board, 'C'))).toBe(`${SIMPLE}\n## C\n\n`)
  })

  it('adds a lane to a board without lanes', () => {
    expect(edit('---\nkanban-plugin: board\n---\n', (board) => addLane(board, 'First'))).toBe(
      '---\nkanban-plugin: board\n---\n\n## First\n\n'
    )
  })

  it('renames lanes and sets WIP limits', () => {
    expect(edit(SIMPLE, (board) => renameLane(board, 1, 'Bee', 2))).toContain('## Bee (2)\n')
    expect(edit('## Doing (3)\n', (board) => renameLane(board, 0, 'Doing', 0))).toBe('## Doing\n')
    expect(edit('### Small (1)\n', (board) => renameLane(board, 0, 'Small', 4))).toBe('### Small (4)\n')
  })

  it('deletes lanes', () => {
    expect(edit(FIXTURE, (board) => deleteLane(board, 1))).toBe(
      FIXTURE.replace('## Doing\n\n- [ ] Fix the importer\n\n', '').replace('[false,false,false]', '[false,false]')
    )
  })

  it('moves lanes and separates them with a blank line', () => {
    const markdown = '## A\n- [ ] a\n\n## B\n- [ ] b\n'
    expect(edit(markdown, (board) => moveLane(board, 1, 0))).toBe('## B\n- [ ] b\n\n## A\n- [ ] a\n\n')
    expect(edit(FIXTURE, (board) => moveLane(board, 0, 2))).toBe(
      FIXTURE.replace(
        '## Todo\n\n- [ ] Prepare demo [[Alpha]]\n- [ ] Write release notes #release\n\n## Doing\n\n- [ ] Fix the importer\n\n## Done\n\n**Complete**\n\n- [x] Set up the repository\n\n',
        '## Doing\n\n- [ ] Fix the importer\n\n## Done\n\n**Complete**\n\n- [x] Set up the repository\n\n## Todo\n\n- [ ] Prepare demo [[Alpha]]\n- [ ] Write release notes #release\n\n'
      )
    )
  })

  it('adds and removes the complete marker', () => {
    const completed = edit(SIMPLE, (board) => setLaneComplete(board, 1, true, ENGLISH_MARKERS))
    expect(completed).toBe(SIMPLE.replace('## B\n\n- [ ] three', '## B\n\n**Complete**\n- [x] three'))
    expect(edit(completed, (board) => setLaneComplete(board, 1, false, ENGLISH_MARKERS))).toBe(
      SIMPLE.replace('- [ ] three', '- [x] three')
    )
    expect(edit(FIXTURE, (board) => setLaneComplete(board, 2, false, ENGLISH_MARKERS))).toContain(
      '## Done\n\n- [x] Set up the repository\n'
    )
    expect(edit('## Empty\n\n## Next\n', (board) => setLaneComplete(board, 0, true, PORTUGUESE_MARKERS))).toBe(
      '## Empty\n\n**Concluído**\n\n## Next\n'
    )
  })

  it('writes markers in the language the board already uses', () => {
    expect(getBoardMarkers(parseBoard(FIXTURE), PORTUGUESE_MARKERS)).toBe(ENGLISH_MARKERS)
    expect(getBoardMarkers(parseBoard('## A\n\n**Concluído**\n'), ENGLISH_MARKERS)).toBe(PORTUGUESE_MARKERS)
    expect(getBoardMarkers(parseBoard(SIMPLE), PORTUGUESE_MARKERS)).toBe(PORTUGUESE_MARKERS)
  })

  it('keeps CRLF line endings when editing', () => {
    const markdown = SIMPLE.replace(/\n/g, '\r\n')
    expect(edit(markdown, (board) => moveCard(board, 0, 0, 1, 1))).toBe(
      SIMPLE.replace('- [ ] one\n', '').replace('- [ ] three\n', '- [ ] three\n- [ ] one\n').replace(/\n/g, '\r\n')
    )
  })

  it('keeps unknown content around edits', () => {
    const markdown = '# Board\n\nIntro text.\n\n## A\n\nLane notes.\n\n- [ ] a\n\nAfter the list.\n\n## B\n\n- [ ] b\n'
    expect(edit(markdown, (board) => moveCard(board, 1, 0, 1, 0))).toBe(markdown)
    expect(edit(markdown, (board) => moveCard(board, 2, 0, 1, 1))).toBe(
      '# Board\n\nIntro text.\n\n## A\n\nLane notes.\n\n- [ ] a\n- [ ] b\n\nAfter the list.\n\n## B\n\n'
    )
  })

  it('rejects invalid indices', () => {
    const board = parseBoard(SIMPLE)
    expect(() => moveCard(board, 0, 5, 1, 0)).toThrow(RangeError)
    expect(() => deleteLane(board, 9)).toThrow(RangeError)
    expect(() => restoreArchivedCard(board, 0, 0)).toThrow(RangeError)
  })
})
