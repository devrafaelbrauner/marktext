import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { MarkdownToState } from '@muyajs/core/state/markdownToState'
import ExportMarkdown from '@muyajs/core/state/stateToMarkdown'

// The fixture vault doubles as sample content for the editor-facing plugins,
// so every note must survive muya's markdown → state → markdown unchanged.
// Exception: muya serializes diagram blocks with backtick fences, so the
// `~~~mermaid` note (kept to exercise tilde-fenced diagrams) is not identical.
const VAULT = path.resolve(__dirname, '../../fixtures/vault')
const TILDE_DIAGRAM_NOTES = [path.join('Diagrams', 'Flow.md')]

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
  const canonical = notes.filter((note) => !TILDE_DIAGRAM_NOTES.includes(path.relative(VAULT, note)))

  it('holds an Obsidian-like vault of 15–25 notes', () => {
    expect(notes.length).toBeGreaterThanOrEqual(15)
    expect(notes.length).toBeLessThanOrEqual(25)
  })

  it.each(canonical.map((note) => [path.relative(VAULT, note), note]))('%s round-trips through muya unchanged', (_name, note) => {
    const markdown = fs.readFileSync(note, 'utf8')
    expect(roundTrip(markdown)).toBe(markdown)
  })
})
