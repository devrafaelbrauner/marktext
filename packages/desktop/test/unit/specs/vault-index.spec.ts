// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FileMetadata } from '@shared/plugins/types'
import { VaultIndex, VAULT_INDEX_CACHE_VERSION } from 'main_renderer/vaultIndex/vaultIndex'
import { loadVaultIndexCache, saveVaultIndexCache } from 'main_renderer/vaultIndex/cache'
import { nodeVaultIndexFs } from 'main_renderer/vaultIndex/nodeFs'

const FIXTURE = path.resolve(__dirname, '../../fixtures/vault')

const relTo = (root: string) => (p: string | null): string | null =>
  p === null ? null : path.relative(root, p).split(path.sep).join('/')

const fileOf = (index: VaultIndex, file: string): FileMetadata => {
  const meta = index.getFile(file)
  if (!meta) throw new Error(`${file} is not indexed`)
  return meta
}

const tagsOf = (index: VaultIndex, file: string): string[] => fileOf(index, file).tags

const resolvedTarget = (meta: FileMetadata, target: string): string | null => {
  const link = meta.links.find((candidate) => candidate.target === target)
  if (!link) throw new Error(`${meta.path} has no link to ${target}`)
  return link.resolved
}

describe('VaultIndex over the fixture vault', () => {
  const index = new VaultIndex(FIXTURE, nodeVaultIndexFs)
  const rel = relTo(FIXTURE)
  const abs = (p: string): string => path.join(FIXTURE, ...p.split('/'))

  beforeAll(async() => {
    await index.scan()
  })

  it('indexes markdown notes and lists other files, skipping hidden folders', () => {
    expect(index.listFiles().map((file) => rel(file.path))).toEqual([
      'Archive/2025/Notes.md',
      'Archive/Notes.md',
      'Daily/2026-10-01.md',
      'Daily/2026-10-02.md',
      'Daily/2026-10-03.md',
      'Diagrams/Flow.md',
      'Home.md',
      'Ideas.md',
      'Notes.md',
      'Projects/Alpha.md',
      'Projects/Beta.md',
      'Projects/Kanban Board.md',
      'Queries/Open Tasks.md',
      'Reading List.md',
      'Tags Edge Cases.md',
      'Templates/Daily Template.md'
    ])
    expect(index.listAssets().map((file) => [rel(file.path), file.extension])).toEqual([['Attachments/sample.pdf', 'pdf']])
    expect(index.getFile(abs('.trash/Deleted.md'))).toBeNull()
  })

  it('fills file metadata from front matter, fields, tasks and the file name', () => {
    const alpha = fileOf(index, abs('Projects/Alpha.md'))
    expect(alpha).toMatchObject({
      name: 'Alpha.md',
      basename: 'Alpha',
      folder: abs('Projects'),
      frontmatter: { status: 'active', priority: 1, started: '2026-09-01', tags: ['project', 'project/alpha'] },
      aliases: ['Project Alpha'],
      tags: ['project', 'project/alpha'],
      fields: { owner: '[[Home]]', budget: 1200, reviewed: false, due: ['2026-10-05', '2026-10-08'], completed: '2026-09-02' },
      day: null
    })
    expect(alpha.headings.map((h) => [h.level, h.text])).toEqual([[1, 'Alpha'], [2, 'Goals'], [2, 'Tasks']])
    expect(alpha.size).toBe(fs.statSync(abs('Projects/Alpha.md')).size)

    expect(index.getFile(abs('Daily/2026-10-03.md'))).toMatchObject({ day: '2026-10-03', fields: { mood: ['great', 'focused'] } })

    const reading = fileOf(index, abs('Reading List.md'))
    expect(reading.tasks.map((task) => [task.status, task.checked])).toEqual([
      [' ', false],
      ['x', true],
      ['/', true],
      ['-', true],
      ['>', true],
      [' ', false],
      ['x', true]
    ])
    expect(reading.tasks[0].fields).toEqual({ due: '2026-10-10' })
  })

  it('parses the Obsidian Kanban board as lanes of tasks with its settings comment masked', () => {
    const board = fileOf(index, abs('Projects/Kanban Board.md'))
    expect(board.frontmatter).toEqual({ 'kanban-plugin': 'board' })
    expect(board.headings.map((h) => h.text)).toEqual(['Todo', 'Doing', 'Done', 'Archive'])
    expect(board.tasks.map((task) => [task.text, task.checked])).toEqual([
      ['Prepare demo [[Alpha]]', false],
      ['Write release notes #release', false],
      ['Fix the importer', false],
      ['Set up the repository', true],
      ['Old card', true]
    ])
  })

  it('resolves links: exact path, shortest basename match, non-markdown names, unresolved', () => {
    const home = fileOf(index, abs('Home.md'))
    expect(home.links.map((link) => [link.target, link.kind, rel(link.resolved)])).toEqual([
      ['Projects/Alpha', 'wikilink', 'Projects/Alpha.md'],
      ['Beta', 'wikilink', 'Projects/Beta.md'],
      ['Ideas', 'wikilink', 'Ideas.md'],
      ['Ideas', 'wikilink', 'Ideas.md'],
      ['sample.pdf', 'wikilink', 'Attachments/sample.pdf'],
      ['Reading List.md', 'markdown', 'Reading List.md'],
      ['Missing Note', 'wikilink', null],
      ['Notes', 'wikilink', 'Notes.md'],
      ['Archive/Notes', 'wikilink', 'Archive/Notes.md'],
      ['Projects/Alpha', 'wikilink', 'Projects/Alpha.md']
    ])
    expect(home.links[3]).toMatchObject({ blockId: 'idea-1' })
    expect(home.links[4]).toMatchObject({ subpath: 'page=2', alias: 'the PDF' })
    expect(rel(index.resolveLink('notes', abs('Archive/2025/Notes.md')))).toBe('Notes.md')
    expect(rel(index.resolveLink('2025/Notes', abs('Home.md')))).toBe('Archive/2025/Notes.md')
    expect(index.resolveLink('Deleted', abs('Home.md'))).toBeNull()
  })

  it('reports backlinks with their line as context, excluding self links and hidden notes', () => {
    expect(
      index.getBacklinks(abs('Projects/Alpha.md')).map((entry) => [rel(entry.sourcePath), entry.link.line, entry.context])
    ).toEqual([
      ['Daily/2026-10-01.md', 4, '- [x] Plan the week for [[Projects/Alpha|Alpha]] #daily'],
      ['Home.md', 12, '- [[Projects/Alpha|Project Alpha]] is the main project.'],
      ['Home.md', 23, '![[Projects/Alpha#Goals]]'],
      ['Ideas.md', 12, '- First idea about [[Projects/Alpha]]'],
      ['Projects/Beta.md', 7, 'Depends on [[Alpha]] and [[Alpha#Goals|its goals]].'],
      ['Projects/Beta.md', 7, 'Depends on [[Alpha]] and [[Alpha#Goals|its goals]].'],
      ['Projects/Beta.md', 9, '![[Alpha#Goals]]'],
      ['Projects/Kanban Board.md', 6, '- [ ] Prepare demo [[Alpha]]']
    ])
    expect(index.getBacklinks(abs('Home.md')).map((entry) => rel(entry.sourcePath))).toEqual([
      'Archive/Notes.md',
      'Notes.md',
      'Projects/Alpha.md'
    ])
    expect(index.getBacklinks(abs('Notes.md')).map((entry) => rel(entry.sourcePath))).toEqual([
      'Home.md',
      'Projects/Alpha.md',
      'Tags Edge Cases.md'
    ])
    expect(index.getBacklinks(abs('Attachments/sample.pdf')).map((entry) => rel(entry.sourcePath))).toEqual([
      'Home.md',
      'Projects/Alpha.md'
    ])
  })

  it('counts tags per note, case-insensitively, with nested tags counting for parents', () => {
    const counts = Object.fromEntries(index.getTags().map((entry) => [entry.tag, entry.count]))
    expect(counts).toMatchObject({
      daily: 3,
      project: 2,
      'project/alpha': 1,
      archive: 2,
      'archive/2025': 1,
      idea: 1,
      'idea/research': 1,
      a: 1,
      'a/b': 1,
      'a/b/c': 1,
      reunião: 1
    })
    expect(Object.keys(counts)).not.toContain('Idea')
    expect(index.getTags()[0]).toEqual({ tag: 'daily', count: 3 })
  })

  it('lists files carrying a tag, optionally including nested tags', () => {
    expect(index.getFilesWithTag('project').map(rel)).toEqual(['Projects/Alpha.md', 'Projects/Beta.md'])
    expect(index.getFilesWithTag('archive').map(rel)).toEqual(['Archive/Notes.md'])
    expect(index.getFilesWithTag('#ARCHIVE', { includeNested: true }).map(rel)).toEqual([
      'Archive/2025/Notes.md',
      'Archive/Notes.md'
    ])
    expect(index.getFilesWithTag('arch', { includeNested: true })).toEqual([])
    expect(index.getFilesWithTag('')).toEqual([])
  })
})

describe('VaultIndex incremental updates', () => {
  let root: string
  let index: VaultIndex
  let rel: (p: string | null) => string | null
  const abs = (p: string): string => path.join(root, ...p.split('/'))

  beforeEach(async() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-index-'))
    fs.cpSync(FIXTURE, root, { recursive: true })
    rel = relTo(root)
    index = new VaultIndex(root, nodeVaultIndexFs)
    await index.scan()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('re-parses a changed note and refreshes tags', async() => {
    fs.appendFileSync(abs('Ideas.md'), '\nNew line with #fresh tag.\n')
    const event = await index.applyChanges([{ type: 'change', path: abs('Ideas.md') }])
    expect(event).toEqual({ changed: [abs('Ideas.md')], removed: [] })
    expect(tagsOf(index, abs('Ideas.md'))).toContain('fresh')
    expect(index.getFilesWithTag('fresh').map(rel)).toEqual(['Ideas.md'])
  })

  it('ignores events for unchanged files and repeated or reordered events', async() => {
    expect(await index.applyChanges([{ type: 'change', path: abs('Home.md') }])).toEqual({ changed: [], removed: [] })
    fs.rmSync(abs('Reading List.md'))
    // Two windows on the same root report the same removal; a stale `add` arrives late.
    const event = await index.applyChanges([
      { type: 'unlink', path: abs('Reading List.md') },
      { type: 'add', path: abs('Reading List.md') },
      { type: 'unlink', path: abs('Reading List.md') }
    ])
    expect(event.removed).toEqual([abs('Reading List.md')])
    expect(index.getFile(abs('Reading List.md'))).toBeNull()
  })

  it('resolves dangling links when the target appears, and reports the linking notes', async() => {
    fs.writeFileSync(abs('Missing Note.md'), '# Missing Note\n')
    const event = await index.applyChanges([{ type: 'add', path: abs('Missing Note.md') }])
    expect(event.changed.map(rel)).toEqual(['Home.md', 'Missing Note.md'])
    expect(index.getBacklinks(abs('Missing Note.md')).map((entry) => rel(entry.sourcePath))).toEqual(['Home.md'])
  })

  it('re-resolves to the next shortest path when a note is deleted', async() => {
    fs.rmSync(abs('Notes.md'))
    const event = await index.applyChanges([{ type: 'unlink', path: abs('Notes.md') }])
    expect(event.removed.map(rel)).toEqual(['Notes.md'])
    // `[#label](Notes.md)` in "Tags Edge Cases" falls back to the archived Notes too.
    expect(event.changed.map(rel)).toEqual(['Home.md', 'Projects/Alpha.md', 'Tags Edge Cases.md'])
    expect(rel(resolvedTarget(fileOf(index, abs('Home.md')), 'Notes'))).toBe('Archive/Notes.md')
    expect(index.getBacklinks(abs('Notes.md'))).toEqual([])
  })

  it('handles a rename as unlink + add', async() => {
    fs.renameSync(abs('Projects/Beta.md'), abs('Projects/Gamma.md'))
    const event = await index.applyChanges([
      { type: 'unlink', path: abs('Projects/Beta.md') },
      { type: 'add', path: abs('Projects/Gamma.md') }
    ])
    expect(event.removed.map(rel)).toEqual(['Projects/Beta.md'])
    expect(event.changed.map(rel)).toEqual(['Archive/Notes.md', 'Daily/2026-10-02.md', 'Home.md', 'Projects/Alpha.md', 'Projects/Gamma.md'])
    expect(resolvedTarget(fileOf(index, abs('Home.md')), 'Beta')).toBeNull()
    expect(index.getFilesWithTag('project/beta').map(rel)).toEqual(['Projects/Gamma.md'])
  })

  it('drops a removed folder and scans an added one', async() => {
    fs.rmSync(abs('Archive'), { recursive: true })
    const removed = await index.applyChanges([{ type: 'unlinkDir', path: abs('Archive') }])
    expect(removed.removed.map(rel)).toEqual(['Archive/2025/Notes.md', 'Archive/Notes.md'])
    // A target naming a folder only matches paths ending in that folder.
    expect(index.resolveLink('Archive/Notes', abs('Home.md'))).toBeNull()
    expect(rel(index.resolveLink('Notes', abs('Home.md')))).toBe('Notes.md')

    fs.mkdirSync(abs('New/Deep'), { recursive: true })
    fs.writeFileSync(abs('New/Deep/Page.md'), 'Links to [[Home]] #new\n')
    fs.writeFileSync(abs('New/image.png'), 'png')
    const added = await index.applyChanges([{ type: 'addDir', path: abs('New') }])
    expect(added.changed.map(rel)).toEqual(['New/Deep/Page.md'])
    expect(index.listAssets().map((asset) => rel(asset.path))).toContain('New/image.png')
    expect(rel(index.resolveLink('image.png', abs('Home.md')))).toBe('New/image.png')
  })

  it('never indexes ignored locations, even when the watcher reports them', async() => {
    fs.mkdirSync(abs('node_modules/pkg'), { recursive: true })
    fs.writeFileSync(abs('node_modules/pkg/readme.md'), '#hidden')
    fs.writeFileSync(abs('.trash/Other.md'), '#hidden')
    const event = await index.applyChanges([
      { type: 'add', path: abs('node_modules/pkg/readme.md') },
      { type: 'add', path: abs('.trash/Other.md') },
      { type: 'add', path: path.join(os.tmpdir(), 'outside.md') }
    ])
    expect(event).toEqual({ changed: [], removed: [] })
  })

  it('honours the tree exclude patterns on scan and on change', async() => {
    const excluded = new VaultIndex(root, nodeVaultIndexFs, { excludePatterns: ['Templates', '*.pdf'] })
    await excluded.scan()
    expect(excluded.getFile(abs('Templates/Daily Template.md'))).toBeNull()
    expect(excluded.listAssets()).toEqual([])
    fs.writeFileSync(abs('Templates/Second.md'), 'x')
    expect(await excluded.applyChanges([{ type: 'add', path: abs('Templates/Second.md') }])).toEqual({ changed: [], removed: [] })
  })
})

describe('VaultIndex persisted cache', () => {
  let root: string
  let cacheFile: string
  const abs = (p: string): string => path.join(root, ...p.split('/'))

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-cache-'))
    fs.cpSync(FIXTURE, root, { recursive: true })
    cacheFile = path.join(root, '..', `${path.basename(root)}.json`)
    // Whole-millisecond mtimes, so utimes can restore them exactly.
    const mtime = new Date('2026-10-01T12:00:00.000Z')
    fs.utimesSync(abs('Ideas.md'), mtime, mtime)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(cacheFile, { force: true })
  })

  const rewriteKeepingStat = (file: string, content: string, mtime: Date): void => {
    fs.writeFileSync(file, content)
    fs.utimesSync(file, mtime, mtime)
  }

  it('round-trips through disk and reuses entries whose mtime and size still match', async() => {
    const first = new VaultIndex(root, nodeVaultIndexFs)
    await first.scan()
    await saveVaultIndexCache(nodeVaultIndexFs, cacheFile, first.toCache())

    // Same size and mtime but different content: only a cache hit keeps the old tag.
    const ideas = abs('Ideas.md')
    const original = fs.readFileSync(ideas, 'utf8')
    const mtime = fs.statSync(ideas).mtime
    rewriteKeepingStat(ideas, original.replace('#idea/research', '#idea/xxxxxxxx'), mtime)

    const second = new VaultIndex(root, nodeVaultIndexFs)
    await second.scan(await loadVaultIndexCache(nodeVaultIndexFs, cacheFile))
    expect(tagsOf(second, ideas)).toContain('idea/research')
    // Links are re-resolved against the current file set, not taken from the cache.
    expect(resolvedTarget(fileOf(second, abs('Home.md')), 'Notes')).toBe(abs('Notes.md'))
  })

  it('re-parses entries whose mtime changed', async() => {
    const first = new VaultIndex(root, nodeVaultIndexFs)
    await first.scan()
    const cache = first.toCache()

    const ideas = abs('Ideas.md')
    const original = fs.readFileSync(ideas, 'utf8')
    rewriteKeepingStat(ideas, original.replace('#idea/research', '#idea/xxxxxxxx'), new Date(Date.now() + 60_000))

    const second = new VaultIndex(root, nodeVaultIndexFs)
    await second.scan(cache)
    expect(tagsOf(second, ideas)).toContain('idea/xxxxxxxx')
    expect(tagsOf(second, ideas)).not.toContain('idea/research')
  })

  it('ignores caches of another root or parser version', async() => {
    const first = new VaultIndex(root, nodeVaultIndexFs)
    await first.scan()
    const ideas = abs('Ideas.md')
    const mtime = fs.statSync(ideas).mtime
    const original = fs.readFileSync(ideas, 'utf8')
    rewriteKeepingStat(ideas, original.replace('#idea/research', '#idea/xxxxxxxx'), mtime)

    for (const cache of [
      { ...first.toCache(), version: VAULT_INDEX_CACHE_VERSION + 1 },
      { ...first.toCache(), rootPath: path.join(root, 'other') }
    ]) {
      const index = new VaultIndex(root, nodeVaultIndexFs)
      await index.scan(cache)
      expect(tagsOf(index, ideas)).toContain('idea/xxxxxxxx')
    }
  })

  it('treats unreadable or malformed cache files as absent', async() => {
    fs.writeFileSync(cacheFile, '{not json')
    expect(await loadVaultIndexCache(nodeVaultIndexFs, cacheFile)).toBeNull()
    fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, rootPath: root, notes: [{ meta: { path: 1 } }, null] }))
    expect(await loadVaultIndexCache(nodeVaultIndexFs, cacheFile)).toEqual({ version: 1, rootPath: root, notes: [] })
    expect(await loadVaultIndexCache(nodeVaultIndexFs, path.join(root, 'missing.json'))).toBeNull()
  })
})
