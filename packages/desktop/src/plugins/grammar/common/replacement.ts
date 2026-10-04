import diff from 'fast-diff'
import type { AnnotationPart } from './types'

export interface BlockTextEdit {
  start: number
  end: number
  /** Current text of `[start, end)`. */
  expected: string
  replacement: string
}

/** A character of the prose projection: prose at `source` in the block text, or one character of a markup's `interpretAs`. */
type ProjectedChar = { kind: 'prose'; source: number } | { kind: 'atom'; atom: number }

/** Markup read as `interpretAs` (inline code, line breaks, …) that lies fully inside the range. */
interface Atom {
  start: number
  end: number
  size: number
}

/**
 * Turns LanguageTool's replacement for `[start, end)` of a block into an edit
 * of the block's markdown that keeps the formatting.
 *
 * LanguageTool reports ranges in the original text (markup included) but
 * proposes replacements for the prose it read, where markup is dropped or
 * read as its `interpretAs`. When the range contains markup, the replacement
 * is diffed against that prose projection and only prose characters change,
 * so `Eu **vai**` with replacement `Eu vou` for `Eu **vai` becomes
 * `Eu **vou**`. Markup read as a word (inline code) is removed only when the
 * replacement drops all of it; markup partially covered by the range is never
 * touched. Inserted text goes where the text it replaces was, otherwise right
 * after the prose it follows, so it inherits that prose's formatting.
 */
export const buildReplacementEdit = (
  text: string,
  annotation: AnnotationPart[],
  start: number,
  end: number,
  replacement: string
): BlockTextEdit => {
  const expected = text.slice(start, end)
  const projection: ProjectedChar[] = []
  const atoms: Atom[] = []
  let projectedText = ''
  let hasMarkup = false

  let pos = 0
  for (const part of annotation) {
    const isText = 'text' in part
    const partStart = pos
    const partEnd = pos + (isText ? part.text.length : part.markup.length)
    pos = partEnd
    if (partEnd <= start || partStart >= end) continue
    if (isText) {
      for (let i = Math.max(partStart, start); i < Math.min(partEnd, end); i++) {
        projection.push({ kind: 'prose', source: i })
        projectedText += text[i]
      }
      continue
    }
    hasMarkup = true
    if (part.interpretAs && partStart >= start && partEnd <= end) {
      const atom = atoms.length
      atoms.push({ start: partStart, end: partEnd, size: part.interpretAs.length })
      for (const char of part.interpretAs) {
        projection.push({ kind: 'atom', atom })
        projectedText += char
      }
    }
  }

  if (!hasMarkup) return { start, end, expected, replacement }

  const insertionPointAt = (index: number): number => {
    if (index > 0) {
      const previous = projection[index - 1]
      return previous.kind === 'prose' ? previous.source + 1 : atoms[previous.atom].end
    }
    const first = projection[0]
    if (!first) return start
    return first.kind === 'prose' ? first.source : atoms[first.atom].start
  }

  const deletedSources = new Set<number>()
  const deletedAtomChars = new Map<number, number>()
  const insertions: Array<{ at: number; text: string }> = []
  const diffs = diff(projectedText, replacement)
  let index = 0
  // Source position of the first prose character removed by the current change run.
  let deleteAnchor: number | null = null

  diffs.forEach(([op, chunk], diffIndex) => {
    if (op === diff.EQUAL) {
      index += chunk.length
      deleteAnchor = null
      return
    }
    if (op === diff.DELETE) {
      for (let i = 0; i < chunk.length; i++, index++) {
        const char = projection[index]
        if (char.kind === 'prose') {
          deletedSources.add(char.source)
          deleteAnchor ??= char.source
        } else {
          deletedAtomChars.set(char.atom, (deletedAtomChars.get(char.atom) ?? 0) + 1)
        }
      }
      return
    }
    let at = deleteAnchor
    if (at === null) {
      const next = diffs[diffIndex + 1]
      const upcoming = projection[index]
      at = next?.[0] === diff.DELETE && upcoming?.kind === 'prose' ? upcoming.source : insertionPointAt(index)
    }
    insertions.push({ at, text: chunk })
  })

  const removedAtoms = atoms.filter((atom, i) => deletedAtomChars.get(i) === atom.size)
  const isRemoved = (source: number): boolean =>
    deletedSources.has(source) || removedAtoms.some((atom) => source >= atom.start && source < atom.end)

  let result = ''
  for (let source = start; source <= end; source++) {
    for (const insertion of insertions) if (insertion.at === source) result += insertion.text
    if (source < end && !isRemoved(source)) result += text[source]
  }
  return { start, end, expected, replacement: result }
}
