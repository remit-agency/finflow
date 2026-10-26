import { describe, expect, it } from 'vitest'
import { addBusinessDays, easterSunday, isBusinessDay, nextBusinessDay, polishHolidays, previousBusinessDay } from '@/lib/utils/pl-calendar'

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))
const keys = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10))

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
  ])('Easter %s is %s', (year, expected) => {
    expect(easterSunday(year).toISOString().slice(0, 10)).toBe(expected)
  })
})

describe('polishHolidays', () => {
  it('2025 has 14 public holidays including Wigilia (new from 2025)', () => {
    expect(keys(polishHolidays(2025))).toEqual([
      '2025-01-01', '2025-01-06', '2025-04-20', '2025-04-21', '2025-05-01', '2025-05-03', '2025-06-08',
      '2025-06-19', '2025-08-15', '2025-11-01', '2025-11-11', '2025-12-24', '2025-12-25', '2025-12-26',
    ])
  })

  it('2026 moves the Easter-based holidays', () => {
    expect(keys(polishHolidays(2026))).toEqual([
      '2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-03', '2026-05-24',
      '2026-06-04', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-24', '2026-12-25', '2026-12-26',
    ])
  })

  it('2024 has no Wigilia', () => {
    expect(keys(polishHolidays(2024))).not.toContain('2024-12-24')
  })

  it('Epiphany is a holiday from 2011 only', () => {
    expect(keys(polishHolidays(2010))).not.toContain('2010-01-06')
    expect(keys(polishHolidays(2011))).toContain('2011-01-06')
  })

  it('is sorted ascending', () => {
    const list = keys(polishHolidays(2027))
    expect(list).toEqual([...list].sort())
  })
})

describe('isBusinessDay', () => {
  it('weekends are not business days', () => {
    expect(isBusinessDay(d(2026, 10, 24))).toBe(false) // Saturday
    expect(isBusinessDay(d(2026, 10, 25))).toBe(false) // Sunday
    expect(isBusinessDay(d(2026, 10, 26))).toBe(true) // Monday
  })

  it('public holidays on weekdays are not business days', () => {
    expect(isBusinessDay(d(2026, 11, 11))).toBe(false) // Wednesday
    expect(isBusinessDay(d(2026, 4, 6))).toBe(false) // Easter Monday
    expect(isBusinessDay(d(2026, 6, 4))).toBe(false) // Corpus Christi (Thursday)
    expect(isBusinessDay(d(2025, 12, 24))).toBe(false)
    expect(isBusinessDay(d(2024, 12, 24))).toBe(true)
  })

  it('ignores the time of day', () => {
    expect(isBusinessDay(new Date(Date.UTC(2026, 9, 26, 17, 45)))).toBe(true)
  })
})

describe('business day navigation', () => {
  it('previousBusinessDay of a Monday is the Friday (NBP rule)', () => {
    expect(previousBusinessDay(d(2026, 10, 26)).toISOString()).toBe(d(2026, 10, 23).toISOString())
  })

  it('previousBusinessDay skips a holiday and a weekend', () => {
    // Monday 2026-04-07 -> Easter Monday 04-06 and Sunday 04-05 are skipped -> Friday 04-03
    expect(previousBusinessDay(d(2026, 4, 7)).toISOString()).toBe(d(2026, 4, 3).toISOString())
  })

  it('nextBusinessDay from a business day returns the next one', () => {
    expect(nextBusinessDay(d(2026, 10, 23)).toISOString()).toBe(d(2026, 10, 26).toISOString())
  })

  it('addBusinessDays goes over holidays and weekends, both directions', () => {
    expect(addBusinessDays(d(2026, 4, 2), 1).toISOString()).toBe(d(2026, 4, 3).toISOString())
    expect(addBusinessDays(d(2026, 4, 3), 1).toISOString()).toBe(d(2026, 4, 7).toISOString())
    expect(addBusinessDays(d(2026, 4, 7), -1).toISOString()).toBe(d(2026, 4, 3).toISOString())
    expect(addBusinessDays(d(2026, 10, 26), 5).toISOString()).toBe(d(2026, 11, 2).toISOString()) // 11-01 is a Sunday, 11-02 a normal Monday, 11-11 not in range
    expect(addBusinessDays(d(2026, 11, 9), 3).toISOString()).toBe(d(2026, 11, 13).toISOString()) // skips 11-11
    expect(addBusinessDays(d(2026, 10, 26), 0).toISOString()).toBe(d(2026, 10, 26).toISOString())
  })
})

describe('invalid input', () => {
  const invalid = new Date(Number.NaN)

  it.each([
    ['isBusinessDay', () => isBusinessDay(invalid)],
    ['previousBusinessDay', () => previousBusinessDay(invalid)],
    ['nextBusinessDay', () => nextBusinessDay(invalid)],
    ['addBusinessDays', () => addBusinessDays(invalid, 1)],
    ['addBusinessDays with a zero count', () => addBusinessDays(invalid, 0)],
  ])('%s throws a RangeError for an invalid Date', (_name, call) => {
    expect(call).toThrow(RangeError)
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'addBusinessDays throws a RangeError for the count %s',
    (count) => {
      expect(() => addBusinessDays(d(2026, 10, 26), count)).toThrow(RangeError)
    },
  )
})
