import { describe, expect, it } from 'vitest'
import type { CheckableBlock, EditorSelection } from '@/plugins/types'
import { correctionEdit, selectionSegments } from '@plugins/ai/renderer/segments'

const block = (index: number, text: string): CheckableBlock => ({
  path: [index, 'text'],
  blockName: 'paragraph.content',
  text,
  annotation: [{ text }]
})

// Block 1 of the document is a code block: it is not checkable, so it is not listed.
const BLOCKS = [block(0, 'Eu vai na escola.'), block(2, 'Nós vai  '), block(3, 'Ele foi.')]

const selection = (anchor: [number, number], focus: [number, number]): EditorSelection => ({
  anchor: { path: [anchor[0], 'text'], offset: anchor[1] },
  focus: { path: [focus[0], 'text'], offset: focus[1] }
})

describe('selectionSegments', () => {
  it('takes the selected range of one block, whichever way it was selected', () => {
    const expected = [{ path: [0, 'text'], start: 3, end: 6, text: 'vai', blockText: 'Eu vai na escola.' }]
    expect(selectionSegments(BLOCKS, selection([0, 3], [0, 6]))).toEqual(expected)
    expect(selectionSegments(BLOCKS, selection([0, 6], [0, 3]))).toEqual(expected)
  })

  it('takes the whole block at a caret', () => {
    expect(selectionSegments(BLOCKS, selection([3, 2], [3, 2]))).toEqual([
      { path: [3, 'text'], start: 0, end: 8, text: 'Ele foi.', blockText: 'Ele foi.' }
    ])
  })

  it('splits a backward selection across blocks in document order, skipping blocks that are not checkable', () => {
    const segments = selectionSegments(BLOCKS, selection([3, 3], [0, 10]))
    expect(segments.map(({ path, start, end, text }) => ({ path, start, end, text }))).toEqual([
      { path: [0, 'text'], start: 10, end: 17, text: 'escola.' },
      { path: [2, 'text'], start: 0, end: 9, text: 'Nós vai  ' },
      { path: [3, 'text'], start: 0, end: 3, text: 'Ele' }
    ])
  })

  it('drops whitespace-only parts and ignores selections ending outside checkable blocks', () => {
    expect(selectionSegments(BLOCKS, selection([0, 17], [2, 4])).map((s) => s.text)).toEqual(['Nós '])
    expect(selectionSegments(BLOCKS, selection([1, 0], [2, 3]))).toEqual([])
    expect(selectionSegments([block(0, '   ')], selection([0, 1], [0, 1]))).toEqual([])
  })
})

describe('correctionEdit', () => {
  it('replaces the segment and keeps the whitespace around it', () => {
    const [segment] = selectionSegments(BLOCKS, selection([2, 0], [2, 9]))
    expect(correctionEdit(segment, ' Nós vamos\n')).toEqual({
      path: [2, 'text'],
      start: 0,
      end: 9,
      expected: 'Nós vai  ',
      replacement: 'Nós vamos  '
    })
  })

  it('is null when the model changed nothing', () => {
    const [segment] = selectionSegments(BLOCKS, selection([3, 0], [3, 8]))
    expect(correctionEdit(segment, 'Ele foi.')).toBeNull()
  })
})
