import { describe, expect, it } from 'vitest'
import type { AnalyticsSelection } from '@/lib/domain/analytics-filter/filter'
import { buildCalendar, formatDayLabel, formatMonthLabel } from '@/lib/utils/analytics'
import type { Transaction } from '@/types'
import { makeTx } from '../helpers/fixtures'

/** The selection the Calendar takes: the operations, and whether the ones excluded from analytics are among them. */
const sel = (operations: Transaction[], includeExcluded = false): AnalyticsSelection<Transaction> => ({ operations, includeExcluded })

let seq = 0
function tx(type: Transaction['type'], amount: number, iso: string): Transaction {
  seq += 1
  return makeTx({ id: `t${seq}`, orgId: 'org', accountId: 'acc', type, amount, currency: 'UAH', date: new Date(iso) })
}
const excluded = (t: Transaction): Transaction => ({ ...t, tags: ['vat'], excluded: true })

describe('labels of the report buckets and columns (S12 builds the reports on the server; the labels stay here)', () => {
  it('a month is the first three letters of its name in the UI language; English writes the full year', () => {
    const months = (locale: 'uk' | 'pl' | 'en') => Array.from({ length: 12 }, (_, m) => formatMonthLabel(2026, m, locale))
    expect(months('uk')).toEqual(['Січ 26', 'Лют 26', 'Бер 26', 'Кві 26', 'Тра 26', 'Чер 26', 'Лип 26', 'Сер 26', 'Вер 26', 'Жов 26', 'Лис 26', 'Гру 26'])
    expect(months('pl')).toEqual(['Sty 26', 'Lut 26', 'Mar 26', 'Kwi 26', 'Maj 26', 'Cze 26', 'Lip 26', 'Sie 26', 'Wrz 26', 'Paź 26', 'Lis 26', 'Gru 26'])
    expect(months('en')).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026'])
  })

  it('a day is its number and the short month, lower case in Ukrainian and Polish', () => {
    const day = new Date(Date.UTC(2026, 9, 19))
    expect([formatDayLabel(day, 'uk'), formatDayLabel(day, 'pl'), formatDayLabel(day, 'en')]).toEqual(['19 жов', '19 paź', '19 Oct'])
  })
})

describe('buildCalendar (the Calendar stays a browser report until S13)', () => {
  it('leaves the excluded operations out, also from the balance carried in (the S10t gap)', () => {
    const txs = [
      excluded(tx('income', 500, '2026-09-10T12:00:00Z')),
      tx('income', 100, '2026-09-11T12:00:00Z'),
      excluded(tx('income', 230, '2026-10-20T10:00:00Z')),
      excluded(tx('expense', 230, '2026-10-20T11:00:00Z')),
      tx('expense', 40, '2026-10-21T12:00:00Z'),
    ]
    const { days } = buildCalendar(sel(txs), 2026, 9)
    expect(days.reduce((s, d) => s + d.income, 0)).toBe(0)
    expect(days.reduce((s, d) => s + d.expense, 0)).toBe(40)
    expect(days[19]).toMatchObject({ date: '2026-10-20', income: 0, expense: 0, hasTransactions: false, balance: 100 })
    expect(days[30].balance).toBe(60)
    const { days: all } = buildCalendar(sel(txs, true), 2026, 9)
    expect(all[19]).toMatchObject({ income: 230, expense: 230, hasTransactions: true, balance: 600 })
    expect(all[30].balance).toBe(560)
  })

  it('an excluded transfer is never counted', () => {
    expect(buildCalendar(sel([excluded(tx('transfer', 230, '2026-10-20T10:00:00Z'))], true), 2026, 9).excludedCounted).toBe(false)
  })

  it('an excluded operation is counted only with a concrete tag (includeExcluded)', () => {
    const txs = [excluded(tx('income', 230, '2026-10-20T10:00:00Z')), tx('expense', 40, '2026-10-21T10:00:00Z')]
    expect(buildCalendar(sel(txs, true), 2026, 9).excludedCounted).toBe(true)
    expect(buildCalendar(sel(txs), 2026, 9).excludedCounted).toBe(false)
  })

  it('says so for the visible month only, or for a balance carried in from an earlier month', () => {
    const txs = [excluded(tx('expense', 230, '2026-10-20T10:00:00Z'))]
    expect(buildCalendar(sel(txs, true), 2026, 8).excludedCounted).toBe(false)
    expect(buildCalendar(sel(txs, true), 2026, 9).excludedCounted).toBe(true)
    expect(buildCalendar(sel(txs, true), 2026, 10).excludedCounted).toBe(true)
  })
})
