// Markdown load/save of the desktop main process (main/filesystem/markdown.ts
// and encoding.ts), ported to pure functions over bytes. Desktop decodes with
// iconv-lite and guesses legacy encodings with the native `ced` addon; neither
// runs in a WebView, so:
//
// - decoding uses TextDecoder, which knows the WHATWG encoding labels;
// - a file that is neither BOM-marked nor valid UTF-8 decodes as Windows-1252
//   when autoGuessEncoding is on (it maps every byte, so nothing is lost on a
//   round trip), instead of ced's guess;
// - saving encodes UTF-8 and UTF-16 LE/BE (with or without BOM) and
//   Windows-1252, the one legacy encoding loading can produce. Any other
//   encoding is refused with UnsupportedEncodingError, which the save flow
//   reports through `mt::tab-save-failure`.

import { posix } from 'pathe'
import type { LineEnding, SaveOptions } from '@shared/types/files'
import type { FileBackend } from './fs/backend'

// main/config.ts (importing it evaluates process.platform).
const LINE_ENDING_REG = /(?:\r\n|\n)/g
const LF_LINE_ENDING_REG = /(?:[^\r]\n)|(?:^\n$)/
const CRLF_LINE_ENDING_REG = /\r\n/

export interface FileEncoding {
  encoding: string
  isBom: boolean
}

/** Payload of `mt::open-new-tab` and the `data` of watcher events. */
export interface MarkdownDocumentRaw {
  markdown: string
  filename: string
  pathname: string
  encoding: FileEncoding
  lineEnding: LineEnding
  adjustLineEndingOnSave: boolean
  trimTrailingNewline: number
  isMixedLineEndings: boolean
}

export interface LoadOptions {
  preferredEol: LineEnding
  autoGuessEncoding: boolean
  trimTrailingNewline: number
  autoNormalizeLineEndings: boolean
}

export interface WriteOptions {
  adjustLineEndingOnSave: boolean
  lineEnding: LineEnding
  encoding: FileEncoding
}

export class UnsupportedEncodingError extends Error {
  readonly code = 'UNSUPPORTED_ENCODING'
  readonly encoding: string

  constructor(encoding: string) {
    super(`Saving as "${encoding}" is not supported on Android; change the file encoding to UTF-8.`)
    this.name = 'UnsupportedEncodingError'
    this.encoding = encoding
  }
}

// Desktop encoding ids (iconv names, see common/encoding.ts) → TextDecoder
// labels. The UTF-32 ids have no WHATWG decoder and are missing on purpose.
const DECODER_LABELS: Record<string, string> = {
  utf8: 'utf-8',
  utf16le: 'utf-16le',
  utf16be: 'utf-16be',
  ascii: 'windows-1252',
  latin3: 'iso-8859-3',
  iso885915: 'iso-8859-15',
  cp1252: 'windows-1252',
  arabic: 'iso-8859-6',
  cp1256: 'windows-1256',
  latin4: 'iso-8859-4',
  cp1257: 'windows-1257',
  iso88592: 'iso-8859-2',
  windows1250: 'windows-1250',
  cp866: 'ibm866',
  iso88595: 'iso-8859-5',
  koi8r: 'koi8-r',
  koi8u: 'koi8-u',
  cp1251: 'windows-1251',
  iso885913: 'iso-8859-13',
  greek: 'iso-8859-7',
  cp1253: 'windows-1253',
  hebrew: 'iso-8859-8',
  cp1255: 'windows-1255',
  latin5: 'windows-1254',
  cp1254: 'windows-1254',
  gb2312: 'gbk',
  gb18030: 'gb18030',
  gbk: 'gbk',
  big5: 'big5',
  big5hkscs: 'big5',
  shiftjis: 'shift_jis',
  eucjp: 'euc-jp',
  euckr: 'euc-kr',
  latin6: 'iso-8859-10'
}

const BOM_ENCODINGS: Array<[string, number[]]> = [
  ['utf8', [0xef, 0xbb, 0xbf]],
  ['utf16be', [0xfe, 0xff]],
  ['utf16le', [0xff, 0xfe]]
]

// A NUL byte signals binary or BOM-less UTF-16, not a UTF-8 text file.
const isLikelyUtf8 = (bytes: Uint8Array): boolean => {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

export function guessEncoding(bytes: Uint8Array, autoGuessEncoding: boolean): FileEncoding {
  for (const [encoding, sequence] of BOM_ENCODINGS) {
    if (bytes.length >= sequence.length && sequence.every((value, index) => bytes[index] === value)) {
      return { encoding, isBom: true }
    }
  }
  if (autoGuessEncoding && !isLikelyUtf8(bytes)) return { encoding: 'cp1252', isBom: false }
  return { encoding: 'utf8', isBom: false }
}

/** loadMarkdownFile without the read: detects encoding, line endings and the final newline. */
export function decodeMarkdown(bytes: Uint8Array, pathname: string, options: LoadOptions): MarkdownDocumentRaw {
  const encoding = guessEncoding(bytes, options.autoGuessEncoding)
  const label = DECODER_LABELS[encoding.encoding]
  if (!label) throw new Error(`"${encoding.encoding}" encoding is not supported.`)
  // The decoder drops a BOM that matches its encoding, like iconv's stripBOM.
  let markdown = new TextDecoder(label).decode(bytes)

  const isLf = LF_LINE_ENDING_REG.test(markdown)
  const isCrlf = CRLF_LINE_ENDING_REG.test(markdown)
  const isMixedLineEndings = isLf && isCrlf
  const isUnknownEnding = !isLf && !isCrlf
  let lineEnding: LineEnding = options.preferredEol
  if (isLf && !isCrlf) {
    lineEnding = 'lf'
  } else if (isCrlf && !isLf) {
    lineEnding = 'crlf'
  }

  let adjustLineEndingOnSave = false
  if (isMixedLineEndings || isUnknownEnding || lineEnding !== 'lf') {
    markdown = markdown.replace(LINE_ENDING_REG, '\n')
    // The editor works on LF only; keep the file's own ending on save unless
    // the user asked to normalize.
    adjustLineEndingOnSave = !options.autoNormalizeLineEndings && lineEnding !== 'lf'
  }

  let trimTrailingNewline = options.trimTrailingNewline
  if (trimTrailingNewline === 2) {
    if (!markdown) {
      trimTrailingNewline = 3
    } else if (markdown.endsWith('\n\n')) {
      trimTrailingNewline = 2
    } else if (markdown.endsWith('\n')) {
      trimTrailingNewline = 1
    } else {
      trimTrailingNewline = 0
    }
  }

  return {
    markdown,
    filename: posix.basename(pathname),
    pathname,
    encoding,
    lineEnding,
    adjustLineEndingOnSave,
    trimTrailingNewline,
    isMixedLineEndings
  }
}

const encodeUtf16 = (text: string, littleEndian: boolean, bom: boolean): Uint8Array => {
  const offset = bom ? 2 : 0
  const out = new Uint8Array(offset + text.length * 2)
  const view = new DataView(out.buffer)
  if (bom) view.setUint16(0, 0xfeff, littleEndian)
  for (let i = 0; i < text.length; i++) view.setUint16(offset + i * 2, text.charCodeAt(i), littleEndian)
  return out
}

// Windows-1252 bytes 0x80-0x9F decode to scattered code points (the five
// undefined ones to C1 controls); the reverse table comes from the decoder so
// both directions agree.
const CP1252_HIGH: Record<number, number> = {}
const cp1252High = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i))
for (let i = 0; i < cp1252High.length; i++) CP1252_HIGH[cp1252High.charCodeAt(i)] = 0x80 + i

const encodeCp1252 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const high = CP1252_HIGH[code]
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) {
      out[i] = code
    } else if (high !== undefined) {
      out[i] = high
    } else {
      throw new Error(`"${text[i]}" cannot be saved as Windows-1252; change the file encoding to UTF-8.`)
    }
  }
  return out
}

/** writeMarkdownFile without the write: re-applies the line ending and encodes. */
export function encodeMarkdown(content: string, options: WriteOptions): Uint8Array {
  const text = options.adjustLineEndingOnSave
    ? content.replace(LINE_ENDING_REG, options.lineEnding === 'crlf' ? '\r\n' : '\n')
    : content
  const { encoding, isBom } = options.encoding
  switch (encoding) {
    case 'utf8': {
      const body = new TextEncoder().encode(text)
      if (!isBom) return body
      const out = new Uint8Array(body.length + 3)
      out.set([0xef, 0xbb, 0xbf])
      out.set(body, 3)
      return out
    }
    case 'utf16le':
      return encodeUtf16(text, true, isBom)
    case 'utf16be':
      return encodeUtf16(text, false, isBom)
    case 'cp1252':
      return encodeCp1252(text)
    default:
      throw new UnsupportedEncodingError(encoding)
  }
}

/**
 * The renderer's save options (help.ts) with every field optional; a legacy
 * string encoding is the encoding id without BOM.
 */
export function toWriteOptions(options: SaveOptions | undefined, preferredEol: LineEnding): WriteOptions {
  const raw = options?.encoding
  const encoding: FileEncoding =
    typeof raw === 'string'
      ? { encoding: raw, isBom: false }
      : { encoding: raw?.encoding || 'utf8', isBom: !!raw?.isBom }
  const lineEnding: LineEnding =
    options?.lineEnding === 'crlf' || options?.lineEnding === 'lf' ? options.lineEnding : preferredEol
  return { adjustLineEndingOnSave: !!options?.adjustLineEndingOnSave, lineEnding, encoding }
}

export async function loadMarkdownFile(
  backend: FileBackend,
  pathname: string,
  options: LoadOptions
): Promise<MarkdownDocumentRaw> {
  return decodeMarkdown(await backend.readFile(pathname), pathname, options)
}

export async function writeMarkdownFile(
  backend: FileBackend,
  pathname: string,
  content: string,
  options: WriteOptions
): Promise<void> {
  await backend.writeFile(pathname, encodeMarkdown(content, options))
}

/** Highest-level heading of the document, the default name of a new file (main/utils). */
export function getRecommendTitleFromMarkdownString(markdown: string): string {
  // The lowest heading level wins; the first heading of that level breaks ties.
  let best: { level: number; content: string } | null = null
  for (const token of markdown.match(/#{1,6} {1,}(.*\S.*)(?:\n|$)/g) ?? []) {
    const matches = /(#{1,6}) {1,}(.+)/.exec(token.trim())
    if (!matches?.[1] || !matches[2]) continue
    if (!best || matches[1].length < best.level) best = { level: matches[1].length, content: matches[2].trim() }
  }
  return best?.content ?? ''
}
