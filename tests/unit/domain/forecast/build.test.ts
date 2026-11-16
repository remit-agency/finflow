import { describe, expect, it } from 'vitest'
import { buildForecast, type ForecastInput } from '@/lib/domain/forecast/build'
import { FORECAST_DAYS } from '@/lib/domain/forecast/types'
import type { PlannedRow } from '@/lib/domain/recurring/types'

const TODAY = '2026-11-16'

const row = (id: string, paymentDate: string, amountMinor: number, type: PlannedRow['type'] = 'expense', over: Partial<PlannedRow> = {}): PlannedRow => ({
  id,
  type,
  accountId: 'a1',
  amountMinor,
  currency: 'PLN',
  paymentDate,
  estimated: false,
  manual: false,
  ...over,
})

const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  today: TODAY,
  baseCurrency: 'PLN',
  minimumMinor: 0,
  startBase: 100_000,
  startIncomplete: false,
  foreignAccounts: false,
  planned: [],
  rates: new Map(),
  names: {},
  truncated: false,
  ...over,
})

describe('buildForecast', () => {
  it('starts from the balance now and adds the planned payments by day', () => {
    const f = buildForecast(input({ planned: [row('p1', '2026-11-18', 30_000), row('p2', '2026-11-20', 50_000, 'income')] }))
    expect(f.days).toHaveLength(FORECAST_DAYS + 1)
    expect(f.days[0]).toMatchObject({ date: TODAY, endBalanceBase: 100_000 })
    expect(f.days[2]).toMatchObject({ date: '2026-11-18', plannedExpenseBase: 30_000, endBalanceBase: 70_000 })
    expect(f.days[4]).toMatchObject({ date: '2026-11-20', plannedIncomeBase: 50_000, endBalanceBase: 120_000 })
    expect(f.days[FORECAST_DAYS].endBalanceBase).toBe(120_000)
    expect(f.gap).toBeNull()
  })

  it('counts an overdue payment as due today', () => {
    const f = buildForecast(input({ planned: [row('late', '2026-11-10', 40_000)] }))
    expect(f.days[0]).toMatchObject({ plannedExpenseBase: 40_000, endBalanceBase: 60_000 })
  })

  it('leaves own transfers out: they do not change the total', () => {
    const f = buildForecast(input({ planned: [row('t1', '2026-11-18', 90_000, 'transfer')] }))
    expect(f.days[2].endBalanceBase).toBe(100_000)
  })

  it('a payment on the last forecast day (today + 90) is counted', () => {
    const f = buildForecast(input({ planned: [row('last', '2027-02-14', 30_000)] }))
    expect(f.days[FORECAST_DAYS]).toMatchObject({ date: '2027-02-14', plannedExpenseBase: 30_000, endBalanceBase: 70_000 })
  })

  it('a payment after the last forecast day (today + 91) changes nothing', () => {
    const baseline = buildForecast(input())
    const f = buildForecast(input({ planned: [row('after', '2027-02-15', 30_000)] }))
    expect(f.days).toEqual(baseline.days)
    expect(f.gap).toEqual(baseline.gap)
    expect(f.unvalued).toBe(0)
  })

  it('an EUR payment without a rate after the last forecast day (today + 91) is neither unvalued nor approximate', () => {
    const f = buildForecast(input({ planned: [row('after', '2027-02-15', 10_000, 'expense', { currency: 'EUR' })] }))
    expect(f.unvalued).toBe(0)
    expect(f.approximate).toBe(false)
  })

  it('finds the first day below the minimum and names the largest expenses of that day', () => {
    const f = buildForecast(
      input({
        minimumMinor: 10_000,
        planned: [
          row('small', '2026-11-24', 5_000, 'expense', { description: 'Coffee' }),
          row('vat', '2026-11-24', 70_000, 'expense', { seriesId: 's-vat' }),
          row('zus', '2026-11-24', 30_000, 'expense', { description: 'ZUS' }),
          row('ink', '2026-11-24', 1_000),
        ],
        names: { 's-vat': 'VAT-7' },
      }),
    )
    // 100000 - 106000 = -6000 on 2026-11-24, below the minimum 10000.
    expect(f.gap).toMatchObject({ date: '2026-11-24', balanceBase: -6_000, minimumBase: 10_000, shortfallBase: 16_000 })
    expect(f.gap?.causes.map((c) => [c.id, c.label])).toEqual([
      ['vat', 'VAT-7'],
      ['zus', 'ZUS'],
      ['small', 'Coffee'],
    ])
    expect(f.lowest).toEqual({ date: '2026-11-24', balanceBase: -6_000 })
  })

  it('a balance equal to the minimum is not a gap', () => {
    const f = buildForecast(input({ minimumMinor: 70_000, planned: [row('p', '2026-11-18', 30_000)] }))
    expect(f.gap).toBeNull()
  })

  it('reports a gap today when the balance is already below the minimum, with no causes', () => {
    const f = buildForecast(input({ startBase: 500, minimumMinor: 1_000 }))
    expect(f.gap).toMatchObject({ date: TODAY, balanceBase: 500, shortfallBase: 500, causes: [] })
  })

  it('converts another currency at the given rate and marks the forecast approximate', () => {
    const f = buildForecast(
      input({
        foreignAccounts: true,
        rates: new Map([['EUR', 4.5]]),
        planned: [row('e', '2026-11-18', 10_000, 'expense', { currency: 'EUR' })],
      }),
    )
    expect(f.days[2].plannedExpenseBase).toBe(45_000)
    expect(f.approximate).toBe(true)
    expect(f.unvalued).toBe(0)
  })

  it('leaves out a payment with no rate and counts it as unvalued', () => {
    const f = buildForecast(input({ planned: [row('e', '2026-11-18', 10_000, 'expense', { currency: 'EUR' })] }))
    expect(f.days[2].plannedExpenseBase).toBe(0)
    expect(f.unvalued).toBe(1)
  })

  it('counts an incomplete start (an account without a rate) as unvalued and passes truncated on', () => {
    const f = buildForecast(input({ startIncomplete: true, truncated: true }))
    expect(f.unvalued).toBe(1)
    expect(f.truncated).toBe(true)
  })
})
