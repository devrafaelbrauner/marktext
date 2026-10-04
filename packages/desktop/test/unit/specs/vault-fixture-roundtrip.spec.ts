import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { MarkdownToState } from '@muyajs/core/state/markdownToState'
import ExportMarkdown from '@muyajs/core/state/stateToMarkdown'

// The fixture vault doubles as sample content for the editor-facing plugins,
// so every note must survive muya's markdown → state → markdown unchanged.
const VAULT = path.resolve(__dirname, '../../fixtures/vault')

const listMarkdown = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listMarkdown(full)
    return entry.name.endsWith('.md') ? [full] : []
  })

const roundTrip = (markdown: string): string => {
  const states = new MarkdownToState({
    footnote: false,
    texMathDollars: true,
    texMathGfm: false,
    texMathSingleBackslash: false,
    texMathDoubleBackslash: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true
  }).generate(markdown)
  return new ExportMarkdown({ listIndentation: 1 }).generate(states)
}

describe('fixture vault', () => {
  const notes = listMarkdown(VAULT)

  it('holds an Obsidian-like vault of 15–25 notes', () => {
    expect(notes.length).toBeGreaterThanOrEqual(15)
    expect(notes.length).toBeLessThanOrEqual(25)
  })

  it.each(notes.map((note) => [path.relative(VAULT, note), note]))('%s round-trips through muya unchanged', (_name, note) => {
    const markdown = fs.readFileSync(note, 'utf8')
    expect(roundTrip(markdown)).toBe(markdown)
  })
})
