import { describe, expect, it } from 'vitest'
import {
  UnsupportedEncodingError,
  decodeMarkdown,
  encodeMarkdown,
  getRecommendTitleFromMarkdownString,
  guessEncoding,
  toWriteOptions,
  type LoadOptions
} from '../src/main/markdownFile'

const options: LoadOptions = {
  preferredEol: 'lf',
  autoGuessEncoding: true,
  trimTrailingNewline: 2,
  autoNormalizeLineEndings: false
}

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('decodeMarkdown encoding detection', () => {
  it('reads plain UTF-8 without a BOM', () => {
    const doc = decodeMarkdown(utf8('# Olá µκα\n'), '/vault/k/v/a.md', options)
    expect(doc.encoding).toEqual({ encoding: 'utf8', isBom: false })
    expect(doc.markdown).toBe('# Olá µκα\n')
    expect(doc.filename).toBe('a.md')
    expect(doc.pathname).toBe('/vault/k/v/a.md')
  })

  it('detects and strips a UTF-8 BOM', () => {
    const doc = decodeMarkdown(concat(bytes(0xef, 0xbb, 0xbf), utf8('hi\n')), '/a.md', options)
    expect(doc.encoding).toEqual({ encoding: 'utf8', isBom: true })
    expect(doc.markdown).toBe('hi\n')
  })

  it('detects UTF-16 LE and BE by their BOM', () => {
    const le = decodeMarkdown(bytes(0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00, 0x0a, 0x00), '/a.md', options)
    expect(le.encoding).toEqual({ encoding: 'utf16le', isBom: true })
    expect(le.markdown).toBe('hé\n')
    const be = decodeMarkdown(bytes(0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9, 0x00, 0x0a), '/a.md', options)
    expect(be.encoding).toEqual({ encoding: 'utf16be', isBom: true })
    expect(be.markdown).toBe('hé\n')
  })

  it('falls back to Windows-1252 for bytes that are not UTF-8 when guessing', () => {
    // "café €" in Windows-1252: é = 0xE9, € = 0x80.
    const legacy = bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x0a)
    const doc = decodeMarkdown(legacy, '/a.md', options)
    expect(doc.encoding).toEqual({ encoding: 'cp1252', isBom: false })
    expect(doc.markdown).toBe('café €\n')
  })

  it('treats a NUL byte as not UTF-8', () => {
    expect(guessEncoding(bytes(0x61, 0x00, 0x62), true).encoding).toBe('cp1252')
  })

  it('decodes as UTF-8 (with replacement) when guessing is off', () => {
    const doc = decodeMarkdown(bytes(0x63, 0xe9, 0x0a), '/a.md', { ...options, autoGuessEncoding: false })
    expect(doc.encoding).toEqual({ encoding: 'utf8', isBom: false })
    expect(doc.markdown).toBe('c\uFFFD\n')
  })
})

describe('decodeMarkdown line endings and final newline', () => {
  it('keeps LF files as they are', () => {
    const doc = decodeMarkdown(utf8('a\nb\n'), '/a.md', options)
    expect(doc).toMatchObject({ lineEnding: 'lf', adjustLineEndingOnSave: false, isMixedLineEndings: false })
  })

  it('normalizes CRLF to LF and restores it on save', () => {
    const doc = decodeMarkdown(utf8('a\r\nb\r\n'), '/a.md', options)
    expect(doc).toMatchObject({ markdown: 'a\nb\n', lineEnding: 'crlf', adjustLineEndingOnSave: true })
  })

  it('does not restore CRLF when line endings are normalized', () => {
    const doc = decodeMarkdown(utf8('a\r\nb\r\n'), '/a.md', { ...options, autoNormalizeLineEndings: true })
    expect(doc).toMatchObject({ markdown: 'a\nb\n', lineEnding: 'crlf', adjustLineEndingOnSave: false })
  })

  it('flags mixed endings and uses the preferred one', () => {
    const doc = decodeMarkdown(utf8('a\r\nb\nc'), '/a.md', { ...options, preferredEol: 'crlf' })
    expect(doc).toMatchObject({ markdown: 'a\nb\nc', lineEnding: 'crlf', isMixedLineEndings: true, adjustLineEndingOnSave: true })
  })

  it('uses the preferred ending for a file without line breaks', () => {
    const doc = decodeMarkdown(utf8('single'), '/a.md', { ...options, preferredEol: 'crlf' })
    expect(doc).toMatchObject({ lineEnding: 'crlf', isMixedLineEndings: false, adjustLineEndingOnSave: true })
  })

  it.each([
    ['', 3],
    ['text', 0],
    ['text\n', 1],
    ['text\n\n', 2]
  ])('detects the final newline of %j as %i', (text, expected) => {
    expect(decodeMarkdown(utf8(text), '/a.md', options).trimTrailingNewline).toBe(expected)
  })

  it('keeps an explicit trimTrailingNewline preference', () => {
    expect(decodeMarkdown(utf8('text\n'), '/a.md', { ...options, trimTrailingNewline: 0 }).trimTrailingNewline).toBe(0)
  })
})

describe('encodeMarkdown', () => {
  it('writes UTF-8 and re-adds a BOM', () => {
    expect(encodeMarkdown('hé', { adjustLineEndingOnSave: false, lineEnding: 'lf', encoding: { encoding: 'utf8', isBom: false } }))
      .toEqual(utf8('hé'))
    expect(encodeMarkdown('hé', { adjustLineEndingOnSave: false, lineEnding: 'lf', encoding: { encoding: 'utf8', isBom: true } }))
      .toEqual(concat(bytes(0xef, 0xbb, 0xbf), utf8('hé')))
  })

  it('re-applies CRLF only when asked to', () => {
    const encoding = { encoding: 'utf8', isBom: false }
    expect(encodeMarkdown('a\nb\n', { adjustLineEndingOnSave: true, lineEnding: 'crlf', encoding })).toEqual(utf8('a\r\nb\r\n'))
    expect(encodeMarkdown('a\nb\n', { adjustLineEndingOnSave: false, lineEnding: 'crlf', encoding })).toEqual(utf8('a\nb\n'))
  })

  it('writes UTF-16 LE/BE with and without BOM', () => {
    const lf = { adjustLineEndingOnSave: false, lineEnding: 'lf' as const }
    expect(encodeMarkdown('hé', { ...lf, encoding: { encoding: 'utf16le', isBom: true } })).toEqual(bytes(0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00))
    expect(encodeMarkdown('hé', { ...lf, encoding: { encoding: 'utf16be', isBom: true } })).toEqual(bytes(0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9))
    expect(encodeMarkdown('h', { ...lf, encoding: { encoding: 'utf16le', isBom: false } })).toEqual(bytes(0x68, 0x00))
  })

  it('round-trips a Windows-1252 file byte for byte', () => {
    const legacy = bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x93, 0x94, 0x81, 0x0a)
    const doc = decodeMarkdown(legacy, '/a.md', options)
    const saved = encodeMarkdown(doc.markdown, { adjustLineEndingOnSave: false, lineEnding: 'lf', encoding: doc.encoding })
    expect(saved).toEqual(legacy)
  })

  it('refuses text Windows-1252 cannot hold', () => {
    expect(() =>
      encodeMarkdown('漢字', { adjustLineEndingOnSave: false, lineEnding: 'lf', encoding: { encoding: 'cp1252', isBom: false } })
    ).toThrow(/Windows-1252/)
  })

  it('refuses other encodings with a typed error', () => {
    const run = (): Uint8Array =>
      encodeMarkdown('x', { adjustLineEndingOnSave: false, lineEnding: 'lf', encoding: { encoding: 'gbk', isBom: false } })
    expect(run).toThrow(UnsupportedEncodingError)
    try {
      run()
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNSUPPORTED_ENCODING', encoding: 'gbk' })
    }
  })
})

describe('save option helpers', () => {
  it('maps the renderer options, including a legacy string encoding', () => {
    expect(toWriteOptions({ encoding: 'utf16le', lineEnding: 'crlf', adjustLineEndingOnSave: true }, 'lf')).toEqual({
      adjustLineEndingOnSave: true,
      lineEnding: 'crlf',
      encoding: { encoding: 'utf16le', isBom: false }
    })
    expect(toWriteOptions(undefined, 'crlf')).toEqual({
      adjustLineEndingOnSave: false,
      lineEnding: 'crlf',
      encoding: { encoding: 'utf8', isBom: false }
    })
  })

  it('names a new file after its highest heading', () => {
    expect(getRecommendTitleFromMarkdownString('text\n## Second\n# First\n# Later\n')).toBe('First')
    expect(getRecommendTitleFromMarkdownString('no heading')).toBe('')
  })
})
