import { describe, expect, it, vi } from 'vitest'
import { buildReplacementEdit } from '@plugins/grammar/common/replacement'
import type { AnnotationPart } from '@plugins/grammar/common/types'
import { applyReplacement } from '@plugins/grammar/renderer/apply'
import type { Problem } from '@plugins/grammar/renderer/scheduler'

// Annotations below have the shape muya's getCheckableBlocks produces for the text.
const textOf = (parts: AnnotationPart[]): string => parts.map((p) => ('text' in p ? p.text : p.markup)).join('')

/** Applies the edit for LanguageTool's `replacement` of `[start, start + length)` and returns the new block text. */
const fix = (parts: AnnotationPart[], start: number, length: number, replacement: string): string => {
  const text = textOf(parts)
  const edit = buildReplacementEdit(text, parts, start, start + length, replacement)
  expect(edit.expected).toBe(text.slice(start, start + length))
  return text.slice(0, edit.start) + edit.replacement + text.slice(edit.end)
}

describe('markup-preserving replacement', () => {
  it('replaces plain prose as-is', () => {
    const parts = [{ text: 'Nós vai à escola.' }]
    const edit = buildReplacementEdit(textOf(parts), parts, 4, 7, 'vamos')
    expect(edit).toEqual({ start: 4, end: 7, expected: 'vai', replacement: 'vamos' })
  })

  it('keeps bold when the range starts before the markup (LanguageTool offsets include markup)', () => {
    // Live API: `Eu **vai** na escola` → offset 0, length 8 (`Eu **vai`), replacement `Eu vou`.
    const parts = [{ text: 'Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }, { text: ' na escola' }]
    const edit = buildReplacementEdit(textOf(parts), parts, 0, 8, 'Eu vou')
    expect(edit).toEqual({ start: 0, end: 8, expected: 'Eu **vai', replacement: 'Eu **vou' })
    expect(fix(parts, 0, 8, 'Eu vou')).toBe('Eu **vou** na escola')
  })

  it('keeps italic markers around a changed word', () => {
    const parts = [{ text: 'Ela ' }, { markup: '*' }, { text: 'foram' }, { markup: '*' }, { text: ' embora' }]
    expect(fix(parts, 4, 7, 'foi')).toBe('Ela *foi* embora')
  })

  it('keeps the link destination when the range covers the whole link', () => {
    const parts = [{ text: 'Veja ' }, { markup: '[' }, { text: 'os documento' }, { markup: '](http://x.y)' }, { text: ' agora' }]
    const text = textOf(parts)
    expect(fix(parts, 5, text.indexOf(' agora') - 5, 'os documentos')).toBe('Veja [os documentos](http://x.y) agora')
  })

  it('edits several words across a bold boundary in one edit', () => {
    const parts = [{ markup: '**' }, { text: 'Os menino' }, { markup: '**' }, { text: ' correu' }]
    expect(fix(parts, 0, 20, 'Os meninos correram')).toBe('**Os meninos** correram')
  })

  it('puts inserted words after the preceding prose, outside the following markup', () => {
    const parts = [{ text: 'Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }]
    expect(fix(parts, 0, 8, 'Eu não vai')).toBe('Eu não **vai**')
  })

  it('keeps inline code read as a placeholder word', () => {
    const parts = [{ text: 'Instale o ' }, { markup: '`npm`', interpretAs: 'X' }, { text: ' pra começar' }]
    const start = 'Instale o '.length
    expect(fix(parts, start, '`npm` pra'.length, 'X para')).toBe('Instale o `npm` para começar')
  })

  it('removes inline code only when the replacement drops the whole placeholder', () => {
    const parts = [{ text: 'o ' }, { markup: '`npm`', interpretAs: 'X' }, { text: ' pra' }]
    expect(fix(parts, 2, '`npm` pra'.length, 'para')).toBe('o para')
  })

  it('leaves markup that the range only partly covers untouched', () => {
    const parts = [{ text: 'Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }]
    // Range `Eu *` ends inside the opening `**`.
    expect(fix(parts, 0, 4, 'Nós ')).toBe('Nós **vai**')
  })

  it('keeps a soft line break read as a space when the replacement keeps the space', () => {
    const parts = [{ text: 'uma' }, { markup: '\n', interpretAs: ' ' }, { text: 'frasse' }]
    expect(fix(parts, 0, 10, 'uma frase')).toBe('uma\nfrase')
  })

  it('handles text containing characters outside the BMP (UTF-16 offsets)', () => {
    const parts = [{ text: '😀 Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }]
    expect(fix(parts, 3, 8, 'Eu vou')).toBe('😀 Eu **vou**')
  })
})

describe('applying a suggestion to the editor', () => {
  const parts = [{ text: 'Eu ' }, { markup: '**' }, { text: 'vai' }, { markup: '**' }, { text: ' na escola' }]
  const problem = (blockText: string): Problem => ({
    id: 'p',
    path: [2],
    blockText,
    start: 0,
    end: 8,
    flagged: blockText.slice(0, 8),
    kind: 'grammar',
    match: {
      offset: 0,
      length: 8,
      message: '',
      shortMessage: '',
      replacements: ['Eu vou'],
      ruleId: 'R',
      ruleDescription: '',
      issueType: 'grammar',
      categoryId: 'GRAMMAR',
      categoryName: '',
      urls: []
    }
  })
  const editorWith = (text: string, annotation: AnnotationPart[]) => ({
    getCheckableBlocks: vi.fn(() => [{ path: [2], blockName: 'paragraph.content', text, annotation }]),
    replaceRange: vi.fn(() => true)
  })

  it('replaces the range with an edit guarded by the current text', () => {
    const editor = editorWith(textOf(parts), parts)
    expect(applyReplacement(editor, problem(textOf(parts)), 'Eu vou')).toBe(true)
    expect(editor.getCheckableBlocks).toHaveBeenCalledWith([[2]])
    expect(editor.replaceRange).toHaveBeenCalledWith({ path: [2], start: 0, end: 8, expected: 'Eu **vai', replacement: 'Eu **vou' })
  })

  it('refuses when the block changed since the problem was found', () => {
    const editor = editorWith('Eu **vai** na escola hoje', [...parts, { text: ' hoje' }])
    expect(applyReplacement(editor, problem(textOf(parts)), 'Eu vou')).toBe(false)
    expect(editor.replaceRange).not.toHaveBeenCalled()
  })
})
