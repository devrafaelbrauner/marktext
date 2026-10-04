import { describe, expect, it } from 'vitest'
import { clampPage, parsePageSubpath } from '@plugins/pdf-reader/common/subpath'
import { classifyLoadError } from '@plugins/pdf-reader/common/errors'

describe('parsePageSubpath', () => {
  it('reads the page of an Obsidian PDF link subpath', () => {
    expect(parsePageSubpath('page=3')).toBe(3)
    expect(parsePageSubpath('#page=12')).toBe(12)
    expect(parsePageSubpath('PAGE=2')).toBe(2)
    expect(parsePageSubpath(' page = 4 ')).toBe(4)
  })

  it('finds page among other fragment parameters', () => {
    expect(parsePageSubpath('zoom=50&page=7')).toBe(7)
    expect(parsePageSubpath('page=5&zoom=page-fit')).toBe(5)
  })

  it('rejects missing, zero, negative, fractional and non-numeric pages', () => {
    for (const subpath of [null, undefined, '', 'page', 'page=', 'page=0', 'page=-1', 'page=2.5', 'page=two', 'page=3x', 'Heading']) {
      expect(parsePageSubpath(subpath)).toBeNull()
    }
  })

  it('ignores absurdly long numbers instead of overflowing', () => {
    expect(parsePageSubpath('page=12345678901234567890')).toBeNull()
  })
})

describe('clampPage', () => {
  it('keeps a page inside the document', () => {
    expect(clampPage(3, 10)).toBe(3)
    expect(clampPage(0, 10)).toBe(1)
    expect(clampPage(42, 10)).toBe(10)
    expect(clampPage(Number.NaN, 10)).toBe(1)
    expect(clampPage(2.6, 10)).toBe(3)
    expect(clampPage(5, 0)).toBe(1)
  })
})

describe('classifyLoadError', () => {
  it('maps pdf.js exceptions and vault error codes to message kinds', () => {
    expect(classifyLoadError({ name: 'PasswordException', code: 1 })).toBe('encrypted')
    expect(classifyLoadError({ name: 'InvalidPDFException' })).toBe('invalid')
    expect(classifyLoadError({ name: 'PluginError', code: 'TOO_LARGE' })).toBe('tooLarge')
    expect(classifyLoadError({ name: 'PluginError', code: 'NOT_FOUND' })).toBe('notFound')
    expect(classifyLoadError({ name: 'PluginError', code: 'OUTSIDE_VAULT' })).toBe('outsideVault')
    expect(classifyLoadError(new Error('boom'))).toBe('unknown')
    expect(classifyLoadError('boom')).toBe('unknown')
    expect(classifyLoadError(null)).toBe('unknown')
  })
})
