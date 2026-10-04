import { describe, expect, it } from 'vitest'
import { annotationLength, buildChunks, mapMatchesToBlocks } from '@plugins/grammar/common/chunking'
import type { AnnotationPart, GrammarMatch } from '@plugins/grammar/common/types'

const joined = (parts: AnnotationPart[]): string => parts.map((p) => ('text' in p ? p.text : p.markup)).join('')

const match = (offset: number, length: number, ruleId = 'R'): GrammarMatch => ({
  offset,
  length,
  message: 'm',
  shortMessage: '',
  replacements: [],
  ruleId,
  ruleDescription: '',
  issueType: 'grammar',
  categoryId: 'GRAMMAR',
  categoryName: 'Gramática',
  urls: []
})

const first = { key: 'a', annotation: [{ text: 'Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }] }
const second = { key: 'b', annotation: [{ text: 'Nós vai.' }] }
const third = { key: 'c', annotation: [{ text: 'Ele foram.' }] }

describe('grammar chunking', () => {
  it('joins blocks with a paragraph-break separator and records where each block starts', () => {
    const { chunks, oversized } = buildChunks([first, second], 1000)
    expect(oversized).toEqual([])
    expect(chunks).toHaveLength(1)
    const [chunk] = chunks
    expect(joined(chunk.annotation)).toBe('Eu **vai**\n\nNós vai.')
    expect(chunk.annotation[4]).toEqual({ markup: '\n\n', interpretAs: '\n\n' })
    expect(chunk.blocks).toEqual([
      { key: 'a', start: 0, length: 10 },
      { key: 'b', start: 12, length: 8 }
    ])
    expect(chunk.length).toBe(20)
  })

  it('maps request offsets back onto each block and drops matches outside a single block', () => {
    const { chunks } = buildChunks([first, second, third], 1000)
    const byBlock = mapMatchesToBlocks(chunks[0], [
      match(0, 8, 'first'),
      match(12, 7, 'second'),
      match(22, 10, 'third'),
      // Spans the end of block a, the separator and the start of block b.
      match(8, 6, 'across'),
      // On the separator only.
      match(10, 2, 'separator')
    ])
    expect(byBlock.get('a')?.map((m) => [m.ruleId, m.offset, m.length])).toEqual([['first', 0, 8]])
    expect(byBlock.get('b')?.map((m) => [m.ruleId, m.offset, m.length])).toEqual([['second', 0, 7]])
    expect(byBlock.get('c')?.map((m) => [m.ruleId, m.offset, m.length])).toEqual([['third', 0, 10]])
  })

  it('starts a new request when the next block would exceed the limit, counting separators', () => {
    // 10 + 2 + 8 = 20 fits exactly; the third block (10) goes to a new request.
    const { chunks } = buildChunks([first, second, third], 20)
    expect(chunks.map((c) => c.blocks.map((b) => b.key))).toEqual([['a', 'b'], ['c']])
    expect(chunks[1].blocks[0].start).toBe(0)
    expect(chunks.every((c) => c.length <= 20)).toBe(true)

    const tight = buildChunks([first, second], 19)
    expect(tight.chunks.map((c) => c.blocks.map((b) => b.key))).toEqual([['a'], ['b']])
  })

  it('reports blocks longer than the limit instead of sending them', () => {
    const long = { key: 'long', annotation: [{ text: 'x'.repeat(50) }] }
    const { chunks, oversized } = buildChunks([second, long, third], 30)
    expect(oversized).toEqual(['long'])
    expect(chunks.map((c) => c.blocks.map((b) => b.key))).toEqual([['b', 'c']])
  })

  it('counts markup and text in the request length', () => {
    expect(annotationLength(first.annotation)).toBe(10)
    expect(annotationLength([{ markup: '`c`', interpretAs: 'X' }])).toBe(3)
  })
})
