import { extractFrontMatter, type FrontMatterBlock } from './frontMatter'

/**
 * A document plus copies of it in which regions that must not yield
 * metadata are replaced by spaces. Every copy has the same length and line
 * breaks as `text`, so offsets found in a copy address `text` directly.
 */
export interface MaskedDocument {
  /** The source with CRLF/CR line endings normalized to LF. */
  text: string
  /** UTF-16 offset of the first character of each line. */
  lineStarts: number[]
  frontMatter: FrontMatterBlock | null
  /** 0-based line of the closing front matter fence, or -1 without front matter. */
  frontMatterEndLine: number
  /** Front matter, fenced/indented code, `$$` math blocks, `<!-- -->` and `%% %%` comments blanked. */
  block: string
  /** `block` plus code spans, inline math, HTML tags, autolinks and backslash escapes (except `\|`) blanked. */
  inline: string
}

const blank = (text: string): string => text.replace(/[^\n]/g, ' ')

const FENCE_OPEN = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})(.*)$/
const LIST_ITEM = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const COMMENT = /<!--[\s\S]*?-->|%%[\s\S]*?%%/g
const BLANK_LINE = /\n[ \t]*\n/g
const HTML_OR_AUTOLINK = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>/y
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

const indentWidth = (line: string): number => {
  let width = 0
  for (const c of line) {
    if (c === ' ') width++
    else if (c === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/**
 * Blanks block-level regions line by line. Indented code is recognised only
 * after a blank line and outside lists, because list continuation lines are
 * indented too and must stay visible.
 */
const maskBlocks = (lines: string[], frontMatterEndLine: number): string[] => {
  const out = lines.slice()
  let fence: { char: string; length: number } | null = null
  let inMath = false
  let inIndentedCode = false
  let inList = false
  let prevBlank = true

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i <= frontMatterEndLine) {
      out[i] = blank(line)
      continue
    }
    if (fence) {
      out[i] = blank(line)
      const close = FENCE_OPEN.exec(line)
      if (close && close[1][0] === fence.char && close[1].length >= fence.length && !close[2].trim()) {
        fence = null
      }
      continue
    }
    if (inMath) {
      out[i] = blank(line)
      if (line.trimEnd().endsWith('$$')) inMath = false
      continue
    }

    const isBlank = !line.trim()
    if (isBlank) {
      prevBlank = true
      continue
    }

    const open = FENCE_OPEN.exec(line)
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], length: open[1].length }
      out[i] = blank(line)
      prevBlank = false
      inIndentedCode = false
      continue
    }
    if (/^[ \t]*\$\$/.test(line)) {
      out[i] = blank(line)
      // A one-line `$$ … $$` block closes on the same line.
      inMath = !(line.trim().length > 2 && line.trimEnd().endsWith('$$'))
      prevBlank = false
      continue
    }

    if (indentWidth(line) >= 4 && (prevBlank || inIndentedCode) && !inList) {
      out[i] = blank(line)
      inIndentedCode = true
      prevBlank = false
      continue
    }
    inIndentedCode = false
    if (LIST_ITEM.test(line)) inList = true
    else if (prevBlank && indentWidth(line) === 0) inList = false
    prevBlank = false
  }
  return out
}

/** Blanks code spans, inline math, HTML tags, autolinks and escapes in block-masked text. */
const maskInline = (source: string): string => {
  const out = source.split('')
  const fill = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }
  const paragraphEnd = (from: number): number => {
    BLANK_LINE.lastIndex = from
    const match = BLANK_LINE.exec(source)
    return match ? match.index : source.length
  }

  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '\\') {
      const next = source[i + 1]
      if (next !== undefined && next !== '|' && ASCII_PUNCTUATION.test(next)) fill(i, i + 2)
      i += 2
      continue
    }
    if (c === '`') {
      let runEnd = i
      while (source[runEnd] === '`') runEnd++
      const length = runEnd - i
      const limit = paragraphEnd(i)
      let j = source.indexOf('`', runEnd)
      let closed = false
      while (j !== -1 && j < limit) {
        let k = j
        while (source[k] === '`') k++
        if (k - j === length) {
          fill(i, k)
          i = k
          closed = true
          break
        }
        j = source.indexOf('`', k)
      }
      if (!closed) i = runEnd
      continue
    }
    if (c === '$') {
      const limit = paragraphEnd(i)
      if (source[i + 1] === '$') {
        const close = source.indexOf('$$', i + 2)
        if (close !== -1 && close < limit) {
          fill(i, close + 2)
          i = close + 2
        } else {
          i += 2
        }
        continue
      }
      // Muya's inline math rules: no space after the opener, no space or
      // backslash before the closer and no digit after it ("$5 and $10").
      const next = source[i + 1]
      if (next !== undefined && !/\s/.test(next)) {
        let j = source.indexOf('$', i + 1)
        while (j !== -1 && j < limit) {
          if (!/[\s\\]/.test(source[j - 1]) && !/\d/.test(source[j + 1] ?? '') && j > i + 1) {
            fill(i, j + 1)
            i = j
            break
          }
          j = source.indexOf('$', j + 1)
        }
      }
      i++
      continue
    }
    if (c === '<') {
      HTML_OR_AUTOLINK.lastIndex = i
      const match = HTML_OR_AUTOLINK.exec(source)
      if (match) {
        fill(i, i + match[0].length)
        i += match[0].length
        continue
      }
    }
    i++
  }
  return out.join('')
}

/** Normalizes line endings and builds the masked copies used by every metadata extractor. */
export const maskDocument = (markdown: string): MaskedDocument => {
  const text = markdown.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const lineStarts: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  const frontMatter = extractFrontMatter(text)
  const frontMatterEndLine = frontMatter ? frontMatter.endLine : -1
  const block = maskBlocks(lines, frontMatterEndLine).join('\n').replace(COMMENT, blank)
  return { text, lineStarts, frontMatter, frontMatterEndLine, block, inline: maskInline(block) }
}

/** 0-based line containing `offset` (binary search over `lineStarts`). */
export const lineOfOffset = (lineStarts: number[], offset: number): number => {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low
}
