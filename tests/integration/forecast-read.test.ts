import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { FORECAST_DAYS } from '@/lib/domain/forecast/types'
import { createTransaction } from '@/lib/server/ledger/write'
import { readCalendarDay, readCalendarMonth, readForecast } from '@/lib/server/forecast/read'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db, { today: () => '2026-10-27' })

async function planned(paymentDate: string, type: 'income' | 'expense', amountMinor: number, accountId = 'pln', description?: string) {
  return createTransaction(deps, ORG, UID, parseTransactionInput({ type, status: 'planned', accountId, amountMinor, paymentDate, description }))
}
async function actual(paymentDate: string, type: 'income' | 'expense', amountMinor: number, accountId = 'pln') {
  return createTransaction(deps, ORG, UID, parseTransactionInput({ type, status: 'actual', accountId, amountMinor, paymentDate }))
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'pln', 'PLN', 100_000)
})

describe('readForecast', () => {
  it('starts from the account balance and finds the first day below the company minimum', async () => {
    await db.doc(`organizations/${ORG}`).update({ cashMinimumMinor: 10_000 })
    await planned('2026-11-05', 'expense', 60_000, 'pln', 'Hosting')
    await planned('2026-11-20', 'expense', 80_000, 'pln', 'VAT')
    const f = await readForecast(deps, ORG)
    expect(f).toMatchObject({ today: '2026-10-27', currency: 'PLN', minimumBase: 10_000, startBase: 100_000, truncated: false, unvalued: 0, approximate: false })
    expect(f.days).toHaveLength(FORECAST_DAYS + 1)
    expect(f.gap).toMatchObject({ date: '2026-11-20', balanceBase: -40_000, shortfallBase: 50_000 })
    expect(f.gap?.causes.map((c) => c.label)).toEqual(['VAT'])
  })

  it('counts an overdue planned payment on today', async () => {
    await planned('2026-10-20', 'expense', 30_000)
    const f = await readForecast(deps, ORG)
    expect(f.days[0]).toMatchObject({ date: '2026-10-27', plannedExpenseBase: 30_000, endBalanceBase: 70_000 })
  })

  it('has no gap with the default minimum 0 when the balance stays positive, and ignores another company', async () => {
    await planned('2026-11-05', 'expense', 60_000)
    expect((await readForecast(deps, ORG)).gap).toBeNull()
    await seedOrg(db, 'other')
    await seedAccount(db, 'other', 'pln', 'PLN', 5_000)
    const other = await readForecast(deps, 'other')
    expect(other.startBase).toBe(5_000)
    expect(other.days.every((d) => d.plannedExpenseBase === 0)).toBe(true)
  })

  it('converts an EUR account at the latest rate and marks the forecast approximate', async () => {
    await seedAccount(db, ORG, 'eur', 'EUR', 10_000)
    const f = await readForecast(deps, ORG)
    // 10000 EUR minor at the fake rate 4.4 is 44000 PLN minor; the PLN account is 100000.
    expect(f).toMatchObject({ approximate: true, startBase: 144_000, unvalued: 0 })
  })

  it('counts a planned payment on today + 90 (the last forecast day) and not one on today + 91', async () => {
    await planned('2027-01-25', 'expense', 30_000)
    await planned('2027-01-26', 'expense', 40_000)
    const f = await readForecast(deps, ORG)
    expect(f.days[FORECAST_DAYS]).toMatchObject({ date: '2027-01-25', plannedExpenseBase: 30_000, endBalanceBase: 70_000 })
    expect(f.days.reduce((sum, d) => sum + d.plannedExpenseBase, 0)).toBe(30_000)
    expect(f.gap).toBeNull()
  })
})

describe('readCalendarMonth', () => {
  it('shows what happened from the rollups, the planned payments and the balance by day', async () => {
    await actual('2026-10-10', 'income', 50_000)
    await actual('2026-10-12', 'expense', 20_000)
    await planned('2026-10-30', 'expense', 15_000)
    const m = await readCalendarMonth(deps, ORG, 2026, 10)
    expect(m.days).toHaveLength(31)
    expect(m.days[9]).toMatchObject({ date: '2026-10-10', kind: 'past', incomeBase: 50_000 })
    expect(m.days[11]).toMatchObject({ date: '2026-10-12', expenseBase: 20_000 })
    // Opening 100000 + 50000 - 20000 = 130000 today; the planned 15000 on the 30th leaves 115000.
    expect(m.days[29]).toMatchObject({ date: '2026-10-30', kind: 'future', plannedExpenseBase: 15_000, endBalanceBase: 115_000 })
    // Close of 2026-10-09: 130000 today minus the movement after that day (+50000 - 20000).
    expect(m.days[8]).toMatchObject({ date: '2026-10-09', kind: 'past', endBalanceBase: 100_000 })
  })

  it('a month beyond the forecast has planned amounts and no balance', async () => {
    await planned('2027-06-10', 'expense', 12_000)
    const m = await readCalendarMonth(deps, ORG, 2027, 6)
    expect(m.days[9]).toMatchObject({ plannedExpenseBase: 12_000, endBalanceBase: null })
  })

  it('a payment on today + 90 has a forecast balance and one on today + 91 has none', async () => {
    await planned('2027-01-25', 'expense', 30_000)
    await planned('2027-01-26', 'expense', 40_000)
    const m = await readCalendarMonth(deps, ORG, 2027, 1)
    expect(m.days[24]).toMatchObject({ date: '2027-01-25', plannedExpenseBase: 30_000, endBalanceBase: 70_000 })
    expect(m.days[25]).toMatchObject({ date: '2027-01-26', plannedExpenseBase: 40_000, endBalanceBase: null, belowMinimum: false })
    expect(m.unvalued).toBe(0)
  })
})

describe('readCalendarDay', () => {
  it('lists the planned and the actual operations of the day', async () => {
    await actual('2026-10-20', 'income', 40_000)
    await planned('2026-10-20', 'expense', 9_000, 'pln', 'Rent')
    await planned('2026-10-21', 'expense', 1_000)
    const d = await readCalendarDay(deps, ORG, '2026-10-20')
    expect(d.date).toBe('2026-10-20')
    expect(d.actual.map((a) => a.amountMinor)).toEqual([40_000])
    expect(d.planned.map((p) => p.amountMinor)).toEqual([9_000])
    expect(d.truncated).toBe(false)
  })
})
