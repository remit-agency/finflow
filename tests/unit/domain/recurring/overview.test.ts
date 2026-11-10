import { describe, expect, it } from 'vitest'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'
import { buildOverview } from '@/lib/domain/recurring/overview'
import type { PlannedRow, Series } from '@/lib/domain/recurring/types'

const TODAY = '2026-11-10'
const row = (id: string, paymentDate: string, over: Partial<PlannedRow> = {}): PlannedRow => ({
  id, type: 'expense', accountId: 'mil', amountMinor: 10_000, currency: 'PLN', paymentDate, estimated: false, manual: false, ...over,
})
const rent: Series = {
  ...seriesFromInput('rent', parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 20, startDate: '2026-01-01' }), 'PLN'),
  generatedThrough: '2027-02-10',
  dueOn: '2026-11-11',
}
const insurance: Series = {
  ...seriesFromInput('ins', parseSeriesInput({ name: 'Ubezpieczenie', kind: 'expense', accountId: 'mil', amountMinor: 90_000, frequency: 'yearly', dayOfMonth: 5, startDate: '2026-06-05' }), 'PLN'),
  generatedThrough: '2027-02-10',
  dueOn: '2026-11-11',
}

describe('buildOverview', () => {
  it('sums the next 7 days per kind and currency, transfers left out', () => {
    const o = buildOverview({
      series: [], overdue: [], overdueCount: 0, truncated: false, today: TODAY,
      upcoming: [
        row('a', '2026-11-10'), row('b', '2026-11-16', { amountMinor: 5_000 }), row('c', '2026-11-17'),
        row('d', '2026-11-12', { type: 'income', amountMinor: 70_000 }), row('e', '2026-11-12', { currency: 'EUR', amountMinor: 1_000 }),
        row('f', '2026-11-11', { type: 'transfer' }),
      ],
    })
    expect(o.soon).toEqual({ income: [{ currency: 'PLN', amountMinor: 70_000 }], expense: [{ currency: 'EUR', amountMinor: 1_000 }, { currency: 'PLN', amountMinor: 15_000 }] })
  })

  it('the next date of a series is its first plan, else the schedule after the filled window; a paused one has none', () => {
    const o = buildOverview({
      series: [{ ...rent, id: 'gym', name: 'Siłownia', status: 'paused' }, insurance, rent], overdue: [], overdueCount: 0, truncated: false, today: TODAY,
      upcoming: [
        row('pl_rent_2026-11-20', '2026-11-20', { seriesId: 'rent', occurrence: '2026-11-20' }),
        row('pl_rent_2026-12-20', '2026-12-21', { seriesId: 'rent', occurrence: '2026-12-20' }),
      ],
    })
    expect(o.series.map((s) => [s.id, s.next])).toEqual([['rent', '2026-11-20'], ['ins', '2027-06-05'], ['gym', null]])
  })

  it('lists the overdue and the next 31 days, and passes the count and the cut through', () => {
    const o = buildOverview({ series: [], overdueCount: 7, truncated: true, today: TODAY, overdue: [row('old', '2026-11-01')], upcoming: [row('in', '2026-12-10'), row('out', '2026-12-11')] })
    expect(o.overdue.map((r) => r.id)).toEqual(['old'])
    expect(o.upcoming.map((r) => r.id)).toEqual(['in'])
    expect(o).toMatchObject({ overdueCount: 7, truncated: true })
  })
})
