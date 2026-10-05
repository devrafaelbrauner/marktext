// @vitest-environment node
import fs from 'fs'
import path from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { VaultIndex } from 'main_renderer/vaultIndex/vaultIndex'
import { nodeVaultIndexFs } from 'main_renderer/vaultIndex/nodeFs'
import { runQuery, type ListResult, type QueryResponse, type QueryResult, type TableResult, type TaskResult } from '@plugins/dataview/common/engine'
import { linkText, valueToString, type LinkValue } from '@plugins/dataview/common/values'

const FIXTURE = path.resolve(__dirname, '../../../../fixtures/vault')
const QUERY_NOTE = path.join(FIXTURE, 'Queries', 'Open Tasks.md')
const NOW = new Date(2026, 9, 4, 12, 0, 0).getTime()

const rel = (p: string): string => path.relative(FIXTURE, p).split(path.sep).join('/')

/** The ```dataview blocks of a fixture note, in order. */
const dataviewBlocks = (file: string): string[] =>
  [...fs.readFileSync(file, 'utf-8').matchAll(/```dataview\n([\s\S]*?)```/g)].map((match) => match[1])

describe('Dataview engine over the fixture vault', () => {
  const index = new VaultIndex(FIXTURE, nodeVaultIndexFs)
  const run = (query: string, origin: string | null = QUERY_NOTE): QueryResponse => runQuery(query, origin, index, { now: NOW })
  const ok = (query: string, origin: string | null = QUERY_NOTE): QueryResult => {
    const response = run(query, origin)
    if (!response.ok) throw new Error(`query failed: ${JSON.stringify(response.error)}`)
    return response.result
  }
  const table = (query: string): TableResult => ok(query) as TableResult
  const list = (query: string): ListResult => ok(query) as ListResult
  const fileNames = (query: string): string[] => {
    const result = ok(query)
    if (result.type === 'table') return result.rows.map((row) => rel(row.link.path))
    if (result.type === 'list') return result.items.map((item) => rel(item.link.path))
    return result.groups.map((group) => rel(group.link.path))
  }

  beforeAll(async() => {
    await index.scan()
  })

  it('answers the TASK block of Queries/Open Tasks.md with open project tasks sorted by due date', () => {
    const [taskQuery] = dataviewBlocks(QUERY_NOTE)
    const result = ok(taskQuery) as TaskResult
    expect(result.type).toBe('task')
    expect(result.groups.map((group) => [rel(group.link.path), group.tasks.map((task) => [task.line, task.status, task.text])])).toEqual([
      [
        'Projects/Alpha.md',
        [
          [23, ' ', 'Write the specification [due:: 2026-10-05] #project/alpha'],
          [25, ' ', 'Review [[Beta]] integration [due:: 2026-10-08]']
        ]
      ],
      ['Projects/Beta.md', [[11, ' ', 'Draft the plan [due:: 2026-10-15]']]]
    ])
    expect(result.total).toBe(3)
  })

  it('answers the TABLE block of Queries/Open Tasks.md with the Projects folder', () => {
    const [, tableQuery] = dataviewBlocks(QUERY_NOTE)
    const result = ok(tableQuery) as TableResult
    expect(result.idColumn).toBe(true)
    expect(result.headers).toEqual(['status', 'priority'])
    expect(result.rows.map((row) => [rel(row.link.path), ...row.cells])).toEqual([
      ['Projects/Alpha.md', 'active', 1],
      ['Projects/Beta.md', 'planned', null],
      ['Projects/Kanban Board.md', null, null]
    ])
  })

  it('selects nested tags case-insensitively', () => {
    expect(fileNames('LIST FROM #project')).toEqual(['Projects/Alpha.md', 'Projects/Beta.md'])
    expect(fileNames('LIST FROM #project/alpha')).toEqual(['Projects/Alpha.md'])
    expect(fileNames('LIST FROM #IDEA')).toEqual(['Ideas.md'])
    expect(fileNames('LIST FROM #archive')).toEqual(['Archive/2025/Notes.md', 'Archive/Notes.md'])
    expect(fileNames('LIST FROM #proj')).toEqual([])
  })

  it('selects folders by prefix and exact note paths', () => {
    expect(fileNames('LIST FROM "Daily"')).toEqual(['Daily/2026-10-01.md', 'Daily/2026-10-02.md', 'Daily/2026-10-03.md'])
    expect(fileNames('LIST FROM "Archive"')).toEqual(['Archive/2025/Notes.md', 'Archive/Notes.md'])
    expect(fileNames('LIST FROM "Archive/"')).toEqual(['Archive/2025/Notes.md', 'Archive/Notes.md'])
    expect(fileNames('LIST FROM "Projects/Alpha"')).toEqual(['Projects/Alpha.md'])
    expect(fileNames('LIST FROM "Proj"')).toEqual([])
  })

  it('selects incoming and outgoing links', () => {
    expect(fileNames('LIST FROM [[Alpha]]')).toEqual(['Daily/2026-10-01.md', 'Home.md', 'Ideas.md', 'Projects/Beta.md', 'Projects/Kanban Board.md'])
    expect(fileNames('LIST FROM outgoing([[Home]])')).toEqual([
      'Archive/Notes.md',
      'Ideas.md',
      'Notes.md',
      'Projects/Alpha.md',
      'Projects/Beta.md',
      'Reading List.md'
    ])
    // Unresolved targets still match the notes that link to them by name.
    expect(fileNames('LIST FROM [[Missing Note]]')).toEqual(['Home.md'])
  })

  it('combines sources with AND, OR, negation and parentheses', () => {
    expect(fileNames('LIST FROM "Projects" AND -#project')).toEqual(['Projects/Kanban Board.md'])
    expect(fileNames('LIST FROM #home OR #moc OR #reading')).toEqual(['Home.md', 'Reading List.md'])
    expect(fileNames('LIST FROM ("Daily" OR "Archive") AND NOT #archive/2025')).toEqual([
      'Archive/Notes.md',
      'Daily/2026-10-01.md',
      'Daily/2026-10-02.md',
      'Daily/2026-10-03.md'
    ])
    // Tags on task lines are page tags too.
    expect(fileNames('LIST FROM #daily AND -#focus')).toEqual(['Daily/2026-10-01.md', 'Daily/2026-10-02.md'])
  })

  it('exposes the implicit file fields', () => {
    const result = table(
      'TABLE file.name, file.folder, file.path, file.ext, file.etags, file.tags, file.aliases, file.day FROM "Projects/Alpha" OR "Daily/2026-10-01"'
    )
    const [alpha, daily] = [result.rows[1], result.rows[0]]
    expect(alpha.cells.slice(0, 7)).toEqual([
      'Alpha',
      'Projects',
      'Projects/Alpha.md',
      'md',
      ['#project', '#project/alpha'],
      ['#project', '#project/alpha'],
      ['Project Alpha']
    ])
    expect(alpha.cells[7]).toBeNull()
    expect(daily.cells[0]).toBe('2026-10-01')
    expect(valueToString(daily.cells[7])).toBe('2026-10-01')
    expect(daily.cells[5]).toEqual(['#daily'])

    const nested = table('TABLE file.tags FROM "Archive/2025"')
    expect(nested.rows[0].cells[0]).toEqual(['#archive', '#archive/2025'])
  })

  it('lists inlinks and outlinks as links', () => {
    const result = table('TABLE file.inlinks, file.outlinks FROM "Notes"')
    const [inlinks, outlinks] = result.rows[0].cells as [LinkValue[], LinkValue[]]
    expect(inlinks.map((link) => rel(link.path))).toEqual(['Home.md', 'Projects/Alpha.md', 'Tags Edge Cases.md'])
    expect(outlinks.map((link) => [rel(link.path), link.resolved])).toEqual([
      ['Notes.md', true],
      ['Home.md', true]
    ])
  })

  it('reads front matter case-insensitively and types inline field values', () => {
    const result = table('TABLE STATUS, started, owner, budget * 2, reviewed, typeof(started) FROM "Projects/Alpha"')
    const [status, started, owner, doubled, reviewed, type] = result.rows[0].cells
    expect(status).toBe('active')
    expect(valueToString(started)).toBe('2026-09-01')
    expect(linkText(owner as LinkValue)).toBe('Home')
    expect(rel((owner as LinkValue).path)).toBe('Home.md')
    expect(doubled).toBe(2400)
    expect(reviewed).toBe(false)
    expect(type).toBe('date')
  })

  it('filters with dates, durations and functions', () => {
    expect(fileNames('LIST FROM "Daily" WHERE file.day >= date(today) - dur(2 days)')).toEqual(['Daily/2026-10-02.md', 'Daily/2026-10-03.md'])
    expect(fileNames('LIST WHERE contains(file.name, "Note")')).toEqual(['Archive/2025/Notes.md', 'Archive/Notes.md', 'Notes.md'])
    expect(fileNames('LIST WHERE contains(mood, "focus")')).toEqual(['Daily/2026-10-03.md'])
    // null sorts before every date, so the comparison alone also keeps notes without `started`.
    expect(fileNames('LIST WHERE started < date(2026-10-01)')).toHaveLength(16)
    expect(fileNames('LIST WHERE started AND started < date(2026-10-01)')).toEqual(['Projects/Alpha.md'])
    expect(fileNames('LIST FROM "Daily" WHERE mood = "good"')).toEqual(['Daily/2026-10-01.md'])
    expect(fileNames('LIST WHERE length(file.tasks) > 3')).toEqual(['Projects/Kanban Board.md', 'Reading List.md'])
  })

  it('sorts stably on several keys and applies LIMIT in written order', () => {
    expect(fileNames('LIST FROM "Daily" SORT file.name DESC')).toEqual(['Daily/2026-10-03.md', 'Daily/2026-10-02.md', 'Daily/2026-10-01.md'])
    expect(fileNames('LIST FROM "Projects" SORT status DESC, file.name ASC')).toEqual([
      'Projects/Beta.md',
      'Projects/Alpha.md',
      'Projects/Kanban Board.md'
    ])
    expect(fileNames('LIST FROM "Daily" LIMIT 2 SORT file.name DESC')).toEqual(['Daily/2026-10-02.md', 'Daily/2026-10-01.md'])
    expect(fileNames('LIST FROM "Daily" SORT file.name DESC LIMIT 1')).toEqual(['Daily/2026-10-03.md'])
  })

  it('renders LIST values and WITHOUT ID tables', () => {
    const values = list('LIST mood FROM "Daily"')
    expect(values.hasValue).toBe(true)
    expect(values.items.map((item) => item.value)).toEqual(['good', 'tired', ['great', 'focused']])

    const plain = table('TABLE WITHOUT ID file.name AS "Name", length(file.tasks) AS Tasks FROM "Daily"')
    expect(plain.idColumn).toBe(false)
    expect(plain.headers).toEqual(['Name', 'Tasks'])
    expect(plain.rows.map((row) => row.cells)).toEqual([
      ['2026-10-01', 2],
      ['2026-10-02', 2],
      ['2026-10-03', 1]
    ])
  })

  it('evaluates TASK queries on task fields and statuses', () => {
    const result = ok('TASK FROM "Reading List" WHERE checked AND !completed') as TaskResult
    expect(result.groups[0].tasks.map((task) => task.status)).toEqual(['/', '-', '>'])
    const due = ok('TASK WHERE due AND due <= date(2026-10-05) SORT due DESC') as TaskResult
    expect(due.groups.map((group) => [rel(group.link.path), group.tasks.map((task) => task.text)])).toEqual([
      ['Projects/Alpha.md', ['Write the specification [due:: 2026-10-05] #project/alpha']],
      ['Daily/2026-10-02.md', ['Review [[Beta]] [due:: 2026-10-03] #daily']]
    ])
    const byFile = ok('TASK WHERE file.name = "2026-10-01"') as TaskResult
    expect(byFile.groups[0].tasks).toHaveLength(2)
  })

  it('resolves `this` and link member access', () => {
    expect(table('TABLE WITHOUT ID this.file.name FROM "Notes"').rows[0].cells).toEqual(['Open Tasks'])
    expect(table('TABLE WITHOUT ID [[Alpha]].status, owner.file.name FROM "Projects/Alpha"').rows[0].cells).toEqual(['active', 'Home'])
  })

  it('caps results and reports the total', () => {
    const result = runQuery('LIST', null, index, { maxResults: 3 })
    if (!result.ok) throw new Error('query failed')
    expect((result.result as ListResult).items).toHaveLength(3)
    expect(result.result.total).toBe(16)
  })

  it('fails with budgetExceeded when evaluation takes too many steps', () => {
    const response = runQuery('LIST WHERE length(file.tasks) + 1 > 0', null, index, { maxSteps: 20 })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe('budgetExceeded')
  })

  it('drops rows whose WHERE fails but reports an error when every row fails', () => {
    // "active" - 1 has no meaning; null - 1 is null.
    expect(fileNames('LIST FROM "Projects" WHERE status - 1 = null')).toEqual(['Projects/Kanban Board.md'])
    const response = run('LIST FROM "Projects/Alpha"\nWHERE status - 1')
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error).toEqual({
        code: 'invalidOperation',
        params: { op: '-', left: 'string', right: 'number' },
        offset: 40,
        line: 2,
        column: 14
      })
    }
  })
})
