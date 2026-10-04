import { afterEach, describe, expect, it } from 'vitest'
import {
  dailyNoteRelativePath,
  dateToKey,
  formatDate,
  isDateKey,
  joinRoot,
  keyToDate,
  normalizeFolder,
  parseDate,
  relativeToRoot,
  templateRelativePath,
  toDayjsLocale
} from '@plugins/daily-notes/common/dates'

const originalTz = process.env.TZ

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('daily-notes date formatting', () => {
  const day = keyToDate('2026-10-04')

  it('formats Obsidian/moment tokens, including advanced and week tokens', () => {
    expect(formatDate(day, 'YYYY-MM-DD', 'en')).toBe('2026-10-04')
    expect(formatDate(day, 'dddd, MMMM Do YYYY', 'en')).toBe('Sunday, October 4th 2026')
    expect(formatDate(day, 'GGGG-[W]WW', 'en')).toBe('2026-W40')
    expect(formatDate(day, 'gggg-[W]ww', 'en')).toBe('2026-W41')
    expect(formatDate(day, '[Q]Q YYYY', 'en')).toBe('Q4 2026')
  })

  it('uses the pt-br locale for localized names', () => {
    expect(formatDate(day, 'dddd, D [de] MMMM [de] YYYY', 'pt-br')).toBe('domingo, 4 de outubro de 2026')
  })

  it('falls back to YYYY-MM-DD for an empty format', () => {
    expect(formatDate(day, '', 'en')).toBe('2026-10-04')
  })

  it('maps UI languages to dayjs locales', () => {
    expect(toDayjsLocale('pt')).toBe('pt-br')
    expect(toDayjsLocale('en')).toBe('en')
    expect(toDayjsLocale('fr')).toBe('en')
  })
})

describe('daily-notes date parsing', () => {
  it('reads dates written with the format', () => {
    expect(parseDate('2026-10-04', 'YYYY-MM-DD', 'en')).toBe('2026-10-04')
    expect(parseDate('20261004', 'YYYYMMDD', 'en')).toBe('2026-10-04')
    expect(parseDate('Daily 2026-10-04', '[Daily] YYYY-MM-DD', 'en')).toBe('2026-10-04')
    expect(parseDate('04.10.26', 'DD.MM.YY', 'en')).toBe('2026-10-04')
  })

  it('reads folder-nested formats only when folders and name agree', () => {
    expect(parseDate('2026/10/2026-10-04', 'YYYY/MM/YYYY-MM-DD', 'en')).toBe('2026-10-04')
    expect(parseDate('2026/11/2026-10-04', 'YYYY/MM/YYYY-MM-DD', 'en')).toBeNull()
    expect(parseDate('2026-10-04', 'YYYY/MM/YYYY-MM-DD', 'en')).toBeNull()
  })

  it('rejects impossible dates and loose spellings', () => {
    expect(parseDate('2026-02-30', 'YYYY-MM-DD', 'en')).toBeNull()
    expect(parseDate('2023-02-29', 'YYYY-MM-DD', 'en')).toBeNull()
    expect(parseDate('2024-02-29', 'YYYY-MM-DD', 'en')).toBe('2024-02-29')
    expect(parseDate('2026-10-4', 'YYYY-MM-DD', 'en')).toBeNull()
    expect(parseDate('Meeting notes', 'YYYY-MM-DD', 'en')).toBeNull()
  })

  it('checks day names the parser itself skips', () => {
    expect(parseDate('2026-10-04 Sunday', 'YYYY-MM-DD dddd', 'en')).toBe('2026-10-04')
    expect(parseDate('2026-10-04 Monday', 'YYYY-MM-DD dddd', 'en')).toBeNull()
  })

  it('reads localized month names only in their locale', () => {
    expect(parseDate('4 de outubro de 2026', 'D [de] MMMM [de] YYYY', 'pt-br')).toBe('2026-10-04')
    expect(parseDate('4 de outubro de 2026', 'D [de] MMMM [de] YYYY', 'en')).toBeNull()
  })

  it('round-trips every day of a leap year', () => {
    let date = keyToDate('2024-01-01')
    for (let i = 0; i < 366; i++) {
      const key = dateToKey(date)
      expect(parseDate(formatDate(date, 'YYYY/MM/YYYY-MM-DD', 'en'), 'YYYY/MM/YYYY-MM-DD', 'en')).toBe(key)
      date = date.add(1, 'day')
    }
    expect(dateToKey(date)).toBe('2025-01-01')
  })
})

describe('daily-notes calendar days', () => {
  it('validates YYYY-MM-DD keys', () => {
    expect(isDateKey('2026-10-04')).toBe(true)
    expect(isDateKey('2026-13-01')).toBe(false)
    expect(isDateKey('2026-02-29')).toBe(false)
    expect(isDateKey('2026-10-4')).toBe(false)
  })

  it('keeps the day when local midnight is skipped by DST', () => {
    // Brazil started DST at 00:00 on 2018-11-04, so that midnight never existed.
    process.env.TZ = 'America/Sao_Paulo'
    expect(dateToKey(keyToDate('2018-11-04'))).toBe('2018-11-04')
    expect(dateToKey(keyToDate('2018-11-04').add(1, 'day'))).toBe('2018-11-05')
    expect(dateToKey(keyToDate('2018-11-04').subtract(1, 'day'))).toBe('2018-11-03')
  })
})

describe('daily-notes paths', () => {
  const day = keyToDate('2026-10-04')

  it('places the note in the folder with the formatted name', () => {
    expect(dailyNoteRelativePath(day, { folder: '', format: 'YYYY-MM-DD', locale: 'en' })).toBe('2026-10-04.md')
    expect(dailyNoteRelativePath(day, { folder: 'Daily', format: 'YYYY-MM-DD', locale: 'en' })).toBe(
      'Daily/2026-10-04.md'
    )
  })

  it('nests notes in folders produced by the format', () => {
    expect(dailyNoteRelativePath(day, { folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD', locale: 'en' })).toBe(
      'Journal/2026/10/2026-10-04.md'
    )
    expect(dailyNoteRelativePath(day, { folder: '', format: 'YYYY/MMMM/D', locale: 'pt-br' })).toBe(
      '2026/outubro/4.md'
    )
  })

  it('normalizes folder spellings and never climbs out of the vault', () => {
    expect(normalizeFolder(' /Daily/ ')).toBe('Daily')
    expect(normalizeFolder('Journal\\Daily\\')).toBe('Journal/Daily')
    expect(normalizeFolder('./a/./b')).toBe('a/b')
    expect(normalizeFolder('../../outside')).toBe('outside')
    expect(dailyNoteRelativePath(day, { folder: '../x', format: 'YYYY-MM-DD', locale: 'en' })).toBe('x/2026-10-04.md')
  })

  it('returns null when the format yields no file name', () => {
    expect(dailyNoteRelativePath(day, { folder: 'Daily', format: '[ ]', locale: 'en' })).toBeNull()
    expect(dailyNoteRelativePath(day, { folder: 'Daily', format: '/', locale: 'en' })).toBeNull()
  })

  it('joins to the root with its own separator', () => {
    expect(joinRoot('/Users/me/vault/', 'Daily/2026-10-04.md')).toBe('/Users/me/vault/Daily/2026-10-04.md')
    expect(joinRoot('C:\\Users\\me\\vault', 'Daily/2026-10-04.md')).toBe('C:\\Users\\me\\vault\\Daily\\2026-10-04.md')
  })

  it('computes root-relative paths without prefix confusion', () => {
    expect(relativeToRoot('/vault', '/vault/Daily/a.md')).toBe('Daily/a.md')
    expect(relativeToRoot('/vault/', '/vault/a.md')).toBe('a.md')
    expect(relativeToRoot('/vault', '/vault2/a.md')).toBeNull()
    expect(relativeToRoot('C:\\vault', 'C:\\vault\\Daily\\a.md')).toBe('Daily/a.md')
  })

  it('resolves the template setting like Obsidian', () => {
    expect(templateRelativePath('Templates/Daily Template')).toBe('Templates/Daily Template.md')
    expect(templateRelativePath('/Templates/Daily.md')).toBe('Templates/Daily.md')
    expect(templateRelativePath('Templates/v1.2')).toBe('Templates/v1.2.md')
    expect(templateRelativePath('   ')).toBeNull()
  })
})
