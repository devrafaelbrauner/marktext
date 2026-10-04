import { describe, expect, it } from 'vitest'
import { DailyNoteIndex, findAdjacentDate, type NoteFileInfo } from '@plugins/daily-notes/common/noteIndex'

const note = (path: string, day: string | null = null, wordCount = 10): NoteFileInfo => ({ path, day, wordCount })

describe('findAdjacentDate', () => {
  const dates = ['2026-09-15', '2026-10-01', '2026-10-03']

  it('steps to the neighbouring existing date', () => {
    expect(findAdjacentDate(dates, '2026-10-01', -1)).toBe('2026-09-15')
    expect(findAdjacentDate(dates, '2026-10-01', 1)).toBe('2026-10-03')
  })

  it('works from a date that has no note', () => {
    expect(findAdjacentDate(dates, '2026-10-02', -1)).toBe('2026-10-01')
    expect(findAdjacentDate(dates, '2026-10-02', 1)).toBe('2026-10-03')
    expect(findAdjacentDate(dates, '2020-01-01', 1)).toBe('2026-09-15')
  })

  it('returns null past either end and for an empty list', () => {
    expect(findAdjacentDate(dates, '2026-09-15', -1)).toBeNull()
    expect(findAdjacentDate(dates, '2026-10-03', 1)).toBeNull()
    expect(findAdjacentDate([], '2026-10-03', 1)).toBeNull()
  })
})

describe('DailyNoteIndex', () => {
  const location = { folder: 'Daily', format: 'YYYY-MM-DD', locale: 'en' }
  const files = [
    note('/vault/Daily/2026-10-01.md', '2026-10-01', 120),
    note('/vault/Daily/2026-10-03.md', '2026-10-03', 800),
    note('/vault/Archive/2026-10-01.md', '2026-10-01', 3),
    note('/vault/Notes/2026-09-15.md', '2026-09-15', 40),
    note('/vault/Daily/Meeting.md'),
    note('/vault/Daily/2026-02-30.md'),
    note('/vault/Home.md')
  ]
  const index = new DailyNoteIndex('/vault', location, files)

  it('collects one note per day, preferring the configured folder', () => {
    expect(index.sortedDates).toEqual(['2026-09-15', '2026-10-01', '2026-10-03'])
    expect(index.get('2026-10-01')).toEqual({ date: '2026-10-01', path: '/vault/Daily/2026-10-01.md', wordCount: 120 })
    expect(index.get('2026-09-15')?.path).toBe('/vault/Notes/2026-09-15.md')
    expect(index.get('2026-10-02')).toBeNull()
  })

  it('selects the previous/next existing note', () => {
    expect(index.adjacent('2026-10-03', -1)?.path).toBe('/vault/Daily/2026-10-01.md')
    expect(index.adjacent('2026-10-01', -1)?.path).toBe('/vault/Notes/2026-09-15.md')
    expect(index.adjacent('2026-10-01', 1)?.path).toBe('/vault/Daily/2026-10-03.md')
    expect(index.adjacent('2026-09-15', -1)).toBeNull()
    expect(index.adjacent('2026-10-03', 1)).toBeNull()
  })

  it('dates the note of a path', () => {
    expect(index.dateOf('/vault/Daily/2026-10-03.md')).toBe('2026-10-03')
    expect(index.dateOf('/vault/Archive/2026-10-01.md')).toBe('2026-10-01')
    expect(index.dateOf('/vault/Daily/Meeting.md')).toBeNull()
    expect(index.dateOf('/vault/Daily/2026-02-30.md')).toBeNull()
    expect(index.dateOf('/elsewhere/2026-10-01.md')).toBeNull()
  })

  it('dates a note the index has not seen yet by its path', () => {
    expect(index.dateOf('/vault/Daily/2026-10-09.md')).toBe('2026-10-09')
    expect(index.dateOf('/vault/Daily/Untitled.md')).toBeNull()
  })

  it('breaks ties between notes outside the folder by path', () => {
    const tie = new DailyNoteIndex('/vault', location, [
      note('/vault/B/2026-10-07.md', '2026-10-07'),
      note('/vault/A/2026-10-07.md', '2026-10-07')
    ])
    expect(tie.get('2026-10-07')?.path).toBe('/vault/A/2026-10-07.md')
  })

  it('reads folder-nested formats and prefers the exact configured path', () => {
    const nested = new DailyNoteIndex('/vault', { folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD', locale: 'en' }, [
      note('/vault/Journal/2026-10-04.md', '2026-10-04'),
      note('/vault/Journal/2026/10/2026-10-04.md', '2026-10-04', 300),
      note('/vault/Journal/2026/11/2026-10-05.md', '2026-10-05'),
      note('/vault/Journal/2026/10/2026-10-06.md', null)
    ])
    expect(nested.get('2026-10-04')?.path).toBe('/vault/Journal/2026/10/2026-10-04.md')
    // Folders that disagree with the name: only the vault index's `day` counts it.
    expect(nested.get('2026-10-05')?.path).toBe('/vault/Journal/2026/11/2026-10-05.md')
    expect(nested.get('2026-10-06')?.path).toBe('/vault/Journal/2026/10/2026-10-06.md')
    expect(nested.sortedDates).toEqual(['2026-10-04', '2026-10-05', '2026-10-06'])
  })

  it('recognizes custom formats the vault index does not date', () => {
    const custom = new DailyNoteIndex('/vault', { folder: '', format: 'D [de] MMMM [de] YYYY', locale: 'pt-br' }, [
      note('/vault/4 de outubro de 2026.md', null, 55)
    ])
    expect(custom.get('2026-10-04')).toEqual({ date: '2026-10-04', path: '/vault/4 de outubro de 2026.md', wordCount: 55 })
  })

  it('finds notes at the configured path even when the format cannot be parsed back', () => {
    const weekly = new DailyNoteIndex('/vault', { folder: 'Weeks', format: 'gggg-[W]ww', locale: 'en' }, [
      note('/vault/Weeks/2026-W41.md', null, 9)
    ])
    expect(weekly.sortedDates).toEqual([])
    expect(weekly.get('2026-10-04')?.path).toBe('/vault/Weeks/2026-W41.md')
  })

  it('handles Windows roots', () => {
    const windows = new DailyNoteIndex('C:\\vault', location, [note('C:\\vault\\Daily\\2026-10-01.md', '2026-10-01')])
    expect(windows.get('2026-10-01')?.path).toBe('C:\\vault\\Daily\\2026-10-01.md')
    expect(windows.dateOf('C:\\vault\\Daily\\2026-10-01.md')).toBe('2026-10-01')
  })
})
