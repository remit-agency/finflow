import { describe, expect, it } from 'vitest'
import {
  addDaysUtc,
  addMonthsUtc,
  buildMonthGrid,
  dayKeyUtc,
  daysInMonthUtc,
  endOfDayUtc,
  formatDayLongUtc,
  formatMonthTitle,
  isDayBetweenUtc,
  shiftMonth,
  startOfWeekUtc,
  weekdayHeaders,
  weekdayMonFirst,
} from '@/lib/utils/calendar-grid'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
const keys = (week: { date: Date }[]) => week.map((c) => dayKeyUtc(c.date))

describe('buildMonthGrid', () => {
  it('October 2026: starts on Monday 28 Sep, ends on Sunday 1 Nov, 5 weeks', () => {
    const grid = buildMonthGrid({ year: 2026, month: 9 })
    expect(grid).toHaveLength(5)
    expect(keys(grid[0])).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ])
    expect(grid[0].map((c) => c.inMonth)).toEqual([false, false, false, true, true, true, true])
    expect(keys(grid[4])).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ])
    expect(grid[4][6].inMonth).toBe(false)
  })

  it('a month starting on Monday has no leading days (June 2026)', () => {
    const grid = buildMonthGrid({ year: 2026, month: 5 })
    expect(dayKeyUtc(grid[0][0].date)).toBe('2026-06-01')
    expect(grid[0][0].inMonth).toBe(true)
  })

  it('February 2027 fits exactly 4 weeks (starts Monday, 28 days)', () => {
    const grid = buildMonthGrid({ year: 2027, month: 1 })
    expect(grid).toHaveLength(4)
    expect(grid.flat().every((c) => c.inMonth)).toBe(true)
  })

  it('a 31-day month starting on Sunday needs 6 weeks (March 2026)', () => {
    const grid = buildMonthGrid({ year: 2026, month: 2 })
    expect(grid).toHaveLength(6)
    expect(dayKeyUtc(grid[0][6].date)).toBe('2026-03-01')
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31)
  })

  it('leap February 2028 has 29 days in the grid', () => {
    expect(buildMonthGrid({ year: 2028, month: 1 }).flat().filter((c) => c.inMonth)).toHaveLength(29)
  })
})

describe('day maths (UTC)', () => {
  it('weekday Monday-first and the start of the week', () => {
    expect(weekdayMonFirst(d('2026-10-19'))).toBe(0) // Monday
    expect(weekdayMonFirst(d('2026-10-25'))).toBe(6) // Sunday
    expect(dayKeyUtc(startOfWeekUtc(d('2026-10-25')))).toBe('2026-10-19')
    expect(dayKeyUtc(startOfWeekUtc(new Date('2026-10-25T23:59:59Z')))).toBe('2026-10-19')
  })

  it('adds days and months; months clamp to the last day', () => {
    expect(dayKeyUtc(addDaysUtc(d('2026-12-31'), 1))).toBe('2027-01-01')
    expect(dayKeyUtc(addMonthsUtc(d('2026-01-31'), 1))).toBe('2026-02-28')
    expect(dayKeyUtc(addMonthsUtc(d('2028-01-31'), 1))).toBe('2028-02-29')
    expect(dayKeyUtc(addMonthsUtc(d('2026-01-15'), -1))).toBe('2025-12-15')
    expect(daysInMonthUtc(2026, 1)).toBe(28)
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
  })

  it('end of day and ranges in any order', () => {
    expect(endOfDayUtc(d('2026-10-23')).toISOString()).toBe('2026-10-23T23:59:59.999Z')
    expect(isDayBetweenUtc(d('2026-10-10'), d('2026-10-12'), d('2026-10-09'))).toBe(true)
    expect(isDayBetweenUtc(d('2026-10-13'), d('2026-10-12'), d('2026-10-09'))).toBe(false)
  })

  it('formats in Ukrainian from the UTC day', () => {
    expect(formatDayLongUtc(d('2026-10-09'), 'uk')).toBe('9 жовтня 2026')
    expect(formatMonthTitle({ year: 2026, month: 9 }, 'uk')).toBe('Жовтень 2026')
    expect(formatDayLongUtc(new Date('2026-03-12T23:59:00Z'), 'uk')).toBe('12 березня 2026')
  })

  it('formats in Polish and English', () => {
    expect(formatDayLongUtc(d('2026-10-09'), 'pl')).toBe('9 października 2026')
    expect(formatMonthTitle({ year: 2026, month: 9 }, 'pl')).toBe('Październik 2026')
    expect(formatDayLongUtc(d('2026-10-09'), 'en')).toBe('9 October 2026')
    expect(formatMonthTitle({ year: 2026, month: 9 }, 'en')).toBe('October 2026')
  })
})

describe('weekdayHeaders', () => {
  it('Monday first, capitalised short names and full names', () => {
    const uk = weekdayHeaders('uk')
    expect(uk.map((h) => h.short)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'])
    expect(uk[0].full).toBe('понеділок')
    expect(uk[6].full).toBe('неділя')
  })

  it('Polish and English', () => {
    expect(weekdayHeaders('pl').map((h) => h.full)).toEqual([
      'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela',
    ])
    expect(weekdayHeaders('pl')[0].short).toMatch(/^Pon/)
    expect(weekdayHeaders('en').map((h) => h.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  })
})
