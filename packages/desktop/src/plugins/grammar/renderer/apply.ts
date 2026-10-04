import type { EditorApi } from '@/plugins/types'
import { buildReplacementEdit } from '../common/replacement'
import type { Problem } from './scheduler'

/**
 * Applies `replacement` to `problem` as one undo step, keeping inline
 * formatting inside the flagged range. Returns false when the block changed
 * since the problem was found (nothing is edited then).
 */
export const applyReplacement = (
  editor: Pick<EditorApi, 'getCheckableBlocks' | 'replaceRange'>,
  problem: Problem,
  replacement: string
): boolean => {
  const [block] = editor.getCheckableBlocks([problem.path])
  if (!block || block.text !== problem.blockText) return false
  const edit = buildReplacementEdit(block.text, block.annotation, problem.start, problem.end, replacement)
  return editor.replaceRange({ path: problem.path, ...edit })
}
