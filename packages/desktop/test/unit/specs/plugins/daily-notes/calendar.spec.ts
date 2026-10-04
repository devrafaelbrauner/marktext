import { afterEach, describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  buildMonthGrid,
  dotLevel,
  formatFullDate,
  formatMonthTitle,
  formatWeekdays,
  monthOf,
  weekdayOrder,
  weekEdge
} from '@plugins/daily-notes/common/calendar'

const originalTz = process.env.TZ

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const keys = (year: number, month: number, weekStart: 'sunday' | 'monday'): string[] =>
  buildMonthGrid(year, month, weekStart).map((cell) => cell.key)

describe('daily-notes month grid', () => {
  it('always has six full weeks starting on the week start', () => {
    for (const weekStart of ['sunday', 'monday'] as const) {
      for (let month = 0; month < 12; month++) {
        const grid = buildMonthGrid(2026, month, weekStart)
        expect(grid).toHaveLength(42)
        expect(grid[0].weekday).toBe(weekStart === 'monday' ? 1 : 0)
        expect(grid.filter((cell) => cell.inMonth)[0].day).toBe(1)
      }
    }
  })

  it('pads October 2026 (starting on a Thursday) with the neighbouring months', () => {
    const sunday = buildMonthGrid(2026, 9, 'sunday')
    expect(sunday[0].key).toBe('2026-09-27')
    expect(sunday[4]).toMatchObject({ key: '2026-10-01', day: 1, weekday: 4, inMonth: true })
    expect(sunday[34].key).toBe('2026-10-31')
    expect(sunday[35]).toMatchObject({ key: '2026-11-01', inMonth: false })
    expect(sunday[41].key).toBe('2026-11-07')

    const monday = buildMonthGrid(2026, 9, 'monday')
    expect(monday[0].key).toBe('2026-09-28')
    expect(monday[3].key).toBe('2026-10-01')
    expect(monday[6].key).toBe('2026-10-04')
  })

  it('starts on the 1st when the month begins on the week start', () => {
    // 2026-02-01 is a Sunday and 2026-06-01 a Monday.
    expect(keys(2026, 1, 'sunday')[0]).toBe('2026-02-01')
    expect(keys(2026, 1, 'monday')[0]).toBe('2026-01-26')
    expect(keys(2026, 5, 'monday')[0]).toBe('2026-06-01')
  })

  it('crosses year boundaries', () => {
    expect(keys(2027, 0, 'sunday')[0]).toBe('2026-12-27')
    expect(keys(2026, 11, 'sunday').at(-1)).toBe('2027-01-09')
  })

  it('counts February days in leap and common years', () => {
    const febDays = (year: number): number => buildMonthGrid(year, 1, 'sunday').filter((cell) => cell.inMonth).length
    expect(febDays(2024)).toBe(29)
    expect(febDays(2026)).toBe(28)
    expect(febDays(2000)).toBe(29)
    expect(febDays(2100)).toBe(28)
    expect(keys(2024, 1, 'sunday')).toContain('2024-02-29')
  })

  it('lists consecutive days through DST changes in any time zone', () => {
    for (const tz of ['America/Sao_Paulo', 'America/New_York', 'Europe/Berlin']) {
      process.env.TZ = tz
      for (const [year, month] of [
        [2018, 10],
        [2026, 2],
        [2026, 9]
      ]) {
        const grid = keys(year, month, 'monday')
        grid.forEach((key, index) => expect(key).toBe(addDays(grid[0], index)))
        expect(new Set(grid).size).toBe(42)
      }
    }
  })

  it('orders weekdays from the week start', () => {
    expect(weekdayOrder('sunday')).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(weekdayOrder('monday')).toEqual([1, 2, 3, 4, 5, 6, 0])
  })
})

describe('daily-notes calendar navigation', () => {
  it('moves by days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-10-04', -7)).toBe('2026-09-27')
  })

  it('moves by months, clamping to the month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28')
  })

  it('finds the edges of the week for the week start', () => {
    // 2026-10-07 is a Wednesday.
    expect(weekEdge('2026-10-07', 'sunday', 'start')).toBe('2026-10-04')
    expect(weekEdge('2026-10-07', 'sunday', 'end')).toBe('2026-10-10')
    expect(weekEdge('2026-10-07', 'monday', 'start')).toBe('2026-10-05')
    expect(weekEdge('2026-10-04', 'monday', 'end')).toBe('2026-10-04')
  })

  it('reports the month of a day', () => {
    expect(monthOf('2026-10-04')).toEqual({ year: 2026, month: 9 })
  })
})

describe('daily-notes dots and labels', () => {
  it('grows the dot with the word count', () => {
    expect(dotLevel(0)).toBe(1)
    expect(dotLevel(49)).toBe(1)
    expect(dotLevel(50)).toBe(2)
    expect(dotLevel(250)).toBe(3)
    expect(dotLevel(750)).toBe(4)
    expect(dotLevel(10_000)).toBe(4)
  })

  it('names months and weekdays in the UI language', () => {
    expect(formatMonthTitle(2026, 9, 'en')).toBe('October 2026')
    expect(formatMonthTitle(2026, 9, 'pt')).toBe('Outubro de 2026')
    expect(formatWeekdays('sunday', 'en').map((day) => day.short)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat'
    ])
    const pt = formatWeekdays('monday', 'pt')
    expect(pt.map((day) => day.short)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'])
    expect(pt[0].long).toBe('Segunda-feira')
  })

  it('spells out full dates for screen readers', () => {
    expect(formatFullDate('2026-10-04', 'en')).toBe('Sunday, October 4, 2026')
    expect(formatFullDate('2026-10-04', 'pt')).toBe('Domingo, 4 de outubro de 2026')
  })
})
