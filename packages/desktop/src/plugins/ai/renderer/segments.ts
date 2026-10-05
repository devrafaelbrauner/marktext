import type { BlockPath, CheckableBlock, EditorSelection, RangeEdit } from '@/plugins/types'

/** The part `[start, end)` of one block's text an AI command works on. */
export interface TextSegment {
  path: BlockPath
  start: number
  end: number
  /** `blockText.slice(start, end)`. */
  text: string
  /** Whole text of the block when the segment was taken. */
  blockText: string
}

const pathKey = (path: BlockPath): string => JSON.stringify(path)

/**
 * Segments of `selection`, in document order, restricted to `blocks` (the
 * document's checkable blocks: code, math, HTML and front matter are never
 * among them). A selection inside one block yields its range; a selection
 * across blocks yields the selected tail of the first block, every block in
 * between and the selected head of the last. A caret yields its whole block,
 * so a command run on the current line needs no selection. Segments with
 * only whitespace are dropped. Empty when an endpoint lies outside the
 * checkable blocks.
 */
export const selectionSegments = (blocks: readonly CheckableBlock[], selection: EditorSelection): TextSegment[] => {
  const order = new Map(blocks.map((block, index) => [pathKey(block.path), index]))
  const anchorIndex = order.get(pathKey(selection.anchor.path))
  const focusIndex = order.get(pathKey(selection.focus.path))
  if (anchorIndex === undefined || focusIndex === undefined) return []

  const anchorFirst =
    anchorIndex < focusIndex || (anchorIndex === focusIndex && selection.anchor.offset <= selection.focus.offset)
  const [first, last] = anchorFirst ? [selection.anchor, selection.focus] : [selection.focus, selection.anchor]
  const [firstIndex, lastIndex] = anchorFirst ? [anchorIndex, focusIndex] : [focusIndex, anchorIndex]
  const collapsed = firstIndex === lastIndex && first.offset === last.offset

  const segments: TextSegment[] = []
  for (let index = firstIndex; index <= lastIndex; index++) {
    const { path, text: blockText } = blocks[index]
    const start = collapsed || index !== firstIndex ? 0 : Math.min(first.offset, blockText.length)
    const end = collapsed || index !== lastIndex ? blockText.length : Math.min(last.offset, blockText.length)
    const text = blockText.slice(start, end)
    if (text.trim()) segments.push({ path, start, end, text, blockText })
  }
  return segments
}

/**
 * Edit replacing `segment` with the model's `corrected` text, keeping the
 * whitespace around the original (models trim their replies), or null when
 * nothing would change.
 */
export const correctionEdit = (segment: TextSegment, corrected: string): RangeEdit | null => {
  const expected = segment.text
  // Segments are never whitespace-only, so the two runs cannot overlap.
  const leading = /^\s*/.exec(expected)?.[0] ?? ''
  const trailing = /\s*$/.exec(expected)?.[0] ?? ''
  const replacement = leading + corrected.trim() + trailing
  if (replacement === expected) return null
  return { path: segment.path, start: segment.start, end: segment.end, expected, replacement }
}
