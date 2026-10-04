import type { AnnotationPart, CheckBlockInput, GrammarMatch } from './types'

/** Joins blocks of one request; read as a paragraph break so sentences never run across blocks. */
export const BLOCK_SEPARATOR = { markup: '\n\n', interpretAs: '\n\n' } satisfies AnnotationPart

export const annotationLength = (annotation: AnnotationPart[]): number => {
  let length = 0
  for (const part of annotation) length += 'text' in part ? part.text.length : part.markup.length
  return length
}

export interface ChunkBlock {
  key: string
  /** Offset of the block's first character in the request text. */
  start: number
  length: number
}

export interface Chunk {
  annotation: AnnotationPart[]
  /** Request text length (text + markup of every part). */
  length: number
  blocks: ChunkBlock[]
}

/**
 * Packs blocks, in order, into requests of at most `maxChars` characters,
 * separated by `BLOCK_SEPARATOR`. A block longer than `maxChars` on its own
 * cannot be sent and is returned in `oversized`.
 */
export const buildChunks = (
  blocks: CheckBlockInput[],
  maxChars: number
): { chunks: Chunk[]; oversized: string[] } => {
  const chunks: Chunk[] = []
  const oversized: string[] = []
  let current: Chunk | null = null

  for (const block of blocks) {
    const length = annotationLength(block.annotation)
    if (length > maxChars) {
      oversized.push(block.key)
      continue
    }
    const separatorLength = current && current.blocks.length > 0 ? BLOCK_SEPARATOR.markup.length : 0
    if (!current || current.length + separatorLength + length > maxChars) {
      current = { annotation: [], length: 0, blocks: [] }
      chunks.push(current)
    } else if (separatorLength > 0) {
      current.annotation.push({ ...BLOCK_SEPARATOR })
      current.length += separatorLength
    }
    current.blocks.push({ key: block.key, start: current.length, length })
    current.annotation.push(...block.annotation.map((part) => ({ ...part })))
    current.length += length
  }
  return { chunks, oversized }
}

/**
 * Splits matches of one request (offsets into the request text) by block and
 * rebases them onto the block text. Matches that are not fully inside one
 * block (e.g. reported on the separator) are dropped.
 */
export const mapMatchesToBlocks = (
  chunk: Chunk,
  matches: GrammarMatch[]
): Map<string, GrammarMatch[]> => {
  const byBlock = new Map<string, GrammarMatch[]>()
  for (const block of chunk.blocks) byBlock.set(block.key, [])
  for (const match of matches) {
    const end = match.offset + match.length
    const block = chunk.blocks.find((b) => match.offset >= b.start && end <= b.start + b.length)
    if (!block || match.length <= 0) continue
    byBlock.get(block.key)?.push({ ...match, offset: match.offset - block.start })
  }
  return byBlock
}
