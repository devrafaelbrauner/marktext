// Full-text and file-name search over the vault, standing in for the ripgrep
// child process desktop spawns (desktop main/ipc/ripgrep.ts). Matching uses
// the editor's own find semantics (muya `matchString`): case-insensitive
// unless asked, `\b` word boundaries, JavaScript regular expressions.

import { Minimatch } from 'minimatch'
import { posix as path } from 'pathe'
import { matchString } from '@muyajs/core/utils/search'
import type { SearchOptions, TextMatch } from './protocol'

/**
 * ripgrep `--iglob` patterns for `globs`, built exactly like desktop's
 * `prepareGlobs`: relative to `directory`, anchored at any depth and
 * also matching everything below a matching folder.
 */
export function prepareGlobs(globs: readonly string[] | undefined, directory: string): string[] {
  const output: string[] = []
  const projectName = path.basename(directory)
  for (let pattern of globs ?? []) {
    if (pattern.length === 0) continue
    if (pattern === projectName) {
      output.push('**/*')
      continue
    }
    if (pattern.startsWith(`${projectName}/`)) pattern = pattern.slice(projectName.length + 1)
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1)
    pattern = pattern.startsWith('**/') ? pattern : `**/${pattern}`
    output.push(pattern)
    output.push(pattern.endsWith('/**') ? pattern : `${pattern}/**`)
  }
  return output
}

/** Whether a file below `directory` passes the request's inclusion and exclusion globs. */
export function createPathFilter(directory: string, options: SearchOptions): (file: string) => boolean {
  const compile = (globs: string[]): Minimatch[] =>
    globs.map((glob) => new Minimatch(glob, { nocase: true, dot: true }))
  const inclusions = compile(prepareGlobs(options.inclusions, directory))
  const exclusions = compile(prepareGlobs(options.exclusions, directory))
  return (file) => {
    const rel = path.relative(directory, file)
    if (!rel || rel.startsWith('..')) return false
    if (inclusions.length > 0 && !inclusions.some((glob) => glob.match(rel))) return false
    return !exclusions.some((glob) => glob.match(rel))
  }
}

const SIZE_UNITS: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }

/** Byte limit of ripgrep's `--max-filesize` value; null means no limit. */
export function parseMaxFileSize(value: SearchOptions['maxFileSize']): number | null {
  if (typeof value === 'number') return value > 0 ? value : null
  const match = typeof value === 'string' ? /^(\d+)([KMG])?$/i.exec(value.trim()) : null
  if (!match) return null
  return Number(match[1]) * (match[2] ? SIZE_UNITS[match[2].toUpperCase()] : 1)
}

/**
 * Matches of `pattern` in `text`, one entry per occurrence like ripgrep's
 * submatches. Lines are matched one at a time; a regular expression holding
 * `\n` runs over the whole text instead (ripgrep `--multiline`) and its
 * `lineText` spans every line it touches. Empty matches are dropped.
 */
export function findTextMatches(text: string, pattern: string, options: SearchOptions): TextMatch[] {
  const flags = {
    isCaseSensitive: options.isCaseSensitive === true,
    isWholeWord: options.isWholeWord === true,
    isRegexp: options.isRegexp === true
  }
  // A literal never spans lines, so one pass over the text rules out most files.
  if (!flags.isRegexp && matchString(text, pattern, flags).length === 0) return []

  const lines = text.split(/\r\n|\n/)
  const out: TextMatch[] = []
  if (flags.isRegexp && pattern.includes('\\n')) {
    const starts: number[] = []
    let offset = 0
    for (const line of lines) {
      starts.push(offset)
      offset += line.length + 1
    }
    const position = (index: number): [number, number] => {
      let row = 0
      while (row + 1 < starts.length && starts[row + 1] <= index) row++
      return [row, index - starts[row]]
    }
    for (const match of matchString(lines.join('\n'), pattern, flags)) {
      if (match.match.length === 0) continue
      const start = position(match.index)
      const end = position(match.index + match.match.length)
      out.push({
        matchText: match.match,
        lineText: lines.slice(start[0], end[0] + 1).join('\n'),
        range: [start, end],
        leadingContextLines: [],
        trailingContextLines: []
      })
    }
    return out
  }
  lines.forEach((line, row) => {
    for (const match of matchString(line, pattern, flags)) {
      if (match.match.length === 0) continue
      out.push({
        matchText: match.match,
        lineText: line,
        range: [[row, match.index], [row, match.index + match.match.length]],
        leadingContextLines: [],
        trailingContextLines: []
      })
    }
  })
  return out
}
