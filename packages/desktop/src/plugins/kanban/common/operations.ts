/**
 * Edits of a parsed board. Every operation mutates the board in place and
 * only touches the source lines of the cards and lanes involved, so
 * `serializeBoard` afterwards differs from the original markdown just where
 * the edit happened.
 */
import {
  createId,
  isCompleteLine,
  KNOWN_MARKERS,
  type BoardMarkers,
  type KanbanArchive,
  type KanbanBoard,
  type KanbanCard,
  type KanbanLane
} from './board'

export const isCardChecked = (card: KanbanCard): boolean => card.checkChar !== null && card.checkChar !== ' '

/** True when the lane has the complete marker: its cards are complete. */
export const isCompleteLane = (lane: KanbanLane): boolean => lane.head.some(isCompleteLine)

const normalizeCardText = (text: string): string => text.replace(/\r\n?/g, '\n').trim()

export const createCard = (text: string, checked = false): KanbanCard => ({
  id: createId('card'),
  marker: '- ',
  checkChar: checked ? 'x' : ' ',
  text: normalizeCardText(text),
  blockId: null,
  lines: null,
  gap: []
})

const setChecked = (card: KanbanCard, checked: boolean): void => {
  if (isCardChecked(card) === checked) return
  const checkChar = checked ? 'x' : ' '
  if (card.lines && card.checkChar !== null) {
    // Only the character between the brackets changes.
    const first = card.lines[0]
    const open = first.indexOf('[', first.indexOf(card.marker.trim()) + card.marker.trim().length)
    card.lines = [first.slice(0, open + 1) + checkChar + first.slice(open + 2), ...card.lines.slice(1)]
  } else {
    card.lines = null
  }
  card.checkChar = checkChar
}

const insertCard = (lane: KanbanLane, card: KanbanCard, index: number): void => {
  const at = Math.max(0, Math.min(index, lane.cards.length))
  const { cards } = lane
  if (at === 0) {
    card.gap = []
    if (cards.length > 0) cards[0].gap = cards.length > 1 ? [...cards[1].gap] : []
  } else {
    // Keep a loose list loose: reuse the separation of the neighbouring card.
    card.gap = [...(at < cards.length ? cards[at].gap : cards.length > 1 ? cards[cards.length - 1].gap : [])]
  }
  cards.splice(at, 0, card)
}

const removeCard = (lane: KanbanLane, index: number): KanbanCard => {
  const [card] = lane.cards.splice(index, 1)
  if (index === 0 && lane.cards.length > 0) lane.cards[0].gap = []
  const { head, tail } = lane
  if (lane.cards.length === 0 && head.length > 0 && head[head.length - 1].trim() === '' && tail[0]?.trim() === '') {
    // The blank lines around the list would otherwise pile up in the emptied lane.
    tail.shift()
  }
  return card
}

const getLane = (board: KanbanBoard, laneIndex: number): KanbanLane => {
  const lane = board.lanes[laneIndex]
  if (!lane) throw new RangeError(`No lane at index ${laneIndex}`)
  return lane
}

const getCard = (lane: KanbanLane, cardIndex: number): KanbanCard => {
  const card = lane.cards[cardIndex]
  if (!card) throw new RangeError(`No card at index ${cardIndex}`)
  return card
}

/** Adds a card at the end of the lane (or at the top); a complete lane adds it checked. */
export const addCard = (
  board: KanbanBoard,
  laneIndex: number,
  text: string,
  position: 'start' | 'end' = 'end'
): KanbanCard => {
  const lane = getLane(board, laneIndex)
  const card = createCard(text, isCompleteLane(lane))
  insertCard(lane, card, position === 'start' ? 0 : lane.cards.length)
  return card
}

export const updateCardText = (board: KanbanBoard, laneIndex: number, cardIndex: number, text: string): void => {
  const card = getCard(getLane(board, laneIndex), cardIndex)
  const next = normalizeCardText(text)
  if (next === card.text) return
  card.text = next
  card.lines = null
}

export const setCardChecked = (board: KanbanBoard, laneIndex: number, cardIndex: number, checked: boolean): void => {
  setChecked(getCard(getLane(board, laneIndex), cardIndex), checked)
}

export const deleteCard = (board: KanbanBoard, laneIndex: number, cardIndex: number): void => {
  const lane = getLane(board, laneIndex)
  getCard(lane, cardIndex)
  removeCard(lane, cardIndex)
}

/**
 * Moves a card to `toIndex` of the target lane (its index after the move).
 * As in Obsidian, entering a complete lane checks the card and leaving one
 * for a regular lane unchecks it.
 */
export const moveCard = (
  board: KanbanBoard,
  fromLane: number,
  fromIndex: number,
  toLane: number,
  toIndex: number
): void => {
  const source = getLane(board, fromLane)
  const target = getLane(board, toLane)
  getCard(source, fromIndex)
  if (source === target && fromIndex === toIndex) return
  const card = removeCard(source, fromIndex)
  if (source !== target) {
    if (isCompleteLane(target)) setChecked(card, true)
    else if (isCompleteLane(source)) setChecked(card, false)
  }
  insertCard(target, card, toIndex)
}

const createArchive = (markers: BoardMarkers): KanbanArchive => ({
  id: createId('lane'),
  title: markers.archive,
  maxItems: 0,
  level: 2,
  headingLine: null,
  head: [''],
  cards: [],
  tail: [],
  tight: false,
  separator: ['***', '']
})

/** Moves a card to the archive, creating the `***` + `## Archive` section after the lanes when needed. */
export const archiveCard = (board: KanbanBoard, laneIndex: number, cardIndex: number, markers: BoardMarkers): void => {
  const lane = getLane(board, laneIndex)
  getCard(lane, cardIndex)
  const card = removeCard(lane, cardIndex)
  if (!board.archive) {
    board.archive = createArchive(markers)
    board.lanesBeforeArchive = board.lanes.length
  }
  insertCard(board.archive, card, board.archive.cards.length)
}

/** Moves an archived card to the end of a lane. */
export const restoreArchivedCard = (board: KanbanBoard, archiveIndex: number, laneIndex: number): void => {
  const archive = board.archive
  if (!archive) throw new RangeError('The board has no archive')
  getCard(archive, archiveIndex)
  const target = getLane(board, laneIndex)
  const card = removeCard(archive, archiveIndex)
  setChecked(card, isCompleteLane(target))
  insertCard(target, card, target.cards.length)
}

export const deleteArchivedCard = (board: KanbanBoard, archiveIndex: number): void => {
  const archive = board.archive
  if (!archive) throw new RangeError('The board has no archive')
  getCard(archive, archiveIndex)
  removeCard(archive, archiveIndex)
}

const updateCollapseState = (board: KanbanBoard, change: (state: unknown[]) => void): void => {
  const state = board.settings['list-collapse']
  if (!Array.isArray(state)) return
  const next = [...state]
  change(next)
  board.settings = { ...board.settings, 'list-collapse': next }
  writeSettings(board)
}

/** Rewrites the JSON of the settings block (only when it parsed as an object). */
const writeSettings = (board: KanbanBoard): void => {
  if (!board.settingsEditable) return
  const open = board.footer.findIndex((line) => /^```/.test(line))
  const close = board.footer.findIndex((line, index) => index > open && /^```/.test(line))
  if (open === -1 || close === -1) return
  board.footer = [...board.footer.slice(0, open + 1), JSON.stringify(board.settings), ...board.footer.slice(close)]
}

/** Appends a lane after the last lane before the archive. */
export const addLane = (board: KanbanBoard, title: string, maxItems = 0): KanbanLane => {
  const lane: KanbanLane = {
    id: createId('lane'),
    title: title.trim(),
    maxItems,
    level: 2,
    headingLine: null,
    head: [''],
    cards: [],
    tail: [],
    tight: false
  }
  const at = Math.min(board.lanesBeforeArchive, board.lanes.length)
  board.lanes.splice(at, 0, lane)
  board.lanesBeforeArchive = at + 1
  updateCollapseState(board, (state) => state.splice(at, 0, false))
  return lane
}

export const renameLane = (board: KanbanBoard, laneIndex: number, title: string, maxItems: number): void => {
  const lane = getLane(board, laneIndex)
  const nextTitle = title.trim()
  const nextMax = Math.max(0, Math.floor(maxItems) || 0)
  if (lane.title === nextTitle && lane.maxItems === nextMax) return
  lane.title = nextTitle
  lane.maxItems = nextMax
  lane.headingLine = null
}

export const deleteLane = (board: KanbanBoard, laneIndex: number): void => {
  getLane(board, laneIndex)
  board.lanes.splice(laneIndex, 1)
  if (laneIndex < board.lanesBeforeArchive) board.lanesBeforeArchive--
  updateCollapseState(board, (state) => state.splice(laneIndex, 1))
}

/** Moves a lane to `toIndex` (its index after the move). */
export const moveLane = (board: KanbanBoard, fromIndex: number, toIndex: number): void => {
  getLane(board, fromIndex)
  const to = Math.max(0, Math.min(toIndex, board.lanes.length - 1))
  if (to === fromIndex) return
  const [lane] = board.lanes.splice(fromIndex, 1)
  board.lanes.splice(to, 0, lane)
  updateCollapseState(board, (state) => {
    const [entry] = state.splice(fromIndex, 1)
    state.splice(to, 0, entry)
  })
}

/** Adds or removes the complete marker (`**Complete**`) under the lane heading. */
export const setLaneComplete = (board: KanbanBoard, laneIndex: number, complete: boolean, markers: BoardMarkers): void => {
  const lane = getLane(board, laneIndex)
  if (isCompleteLane(lane) === complete) return
  if (complete) {
    // Obsidian writes the marker right after the blank line under the heading.
    const at = lane.head.length > 0 && lane.head[0].trim() === '' ? 1 : 0
    // A blank line keeps the marker apart from following content; Obsidian puts cards right under it.
    const blankAfter = at < lane.head.length ? lane.head[at].trim() !== '' : lane.cards.length === 0
    lane.head.splice(at, 0, `**${markers.complete}**`, ...(blankAfter ? [''] : []))
    for (const card of lane.cards) setChecked(card, true)
    return
  }
  const index = lane.head.findIndex(isCompleteLine)
  const blankAfter = index + 1 < lane.head.length && lane.head[index + 1].trim() === ''
  const blankBefore = index === 0 || lane.head[index - 1].trim() === ''
  lane.head.splice(index, blankAfter && blankBefore ? 2 : 1)
}

/**
 * Markers for new complete markers and a new archive: the language the board
 * already uses (an Obsidian in another language would not recognise a mix),
 * otherwise the one of the UI language.
 */
export const getBoardMarkers = (board: KanbanBoard, fallback: BoardMarkers): BoardMarkers => {
  for (const markers of KNOWN_MARKERS) {
    if (board.archive?.title === markers.archive) return markers
    if (board.lanes.some((lane) => lane.head.some((line) => isCompleteLine(line) && line.includes(markers.complete)))) {
      return markers
    }
  }
  return fallback
}
