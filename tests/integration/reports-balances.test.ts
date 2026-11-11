import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { createTransaction } from '@/lib/server/ledger/write'
import { readBalances, readDashboard } from '@/lib/server/reports/balances'
import { ORG, TODAY, UID, makeDeps, testDb } from './helpers'
import { seedReportCompany, steppedRate } from './report-helpers'

const db = testDb()
const deps = makeDeps(db, { resolveRate: steppedRate })

beforeEach(async () => {
  await seedReportCompany(db, deps)
})

describe('balances on a day (S12)', () => {
  it('each account at the close of a past day, valued at the last NBP table of that day', async () => {
    const { report } = await readBalances(deps, ORG, '2026-10-15')
    expect(report.accounts.map((a) => [a.accountId, a.balanceMinor, a.baseMinor])).toEqual([
      ['eur', 15_000, 66_000],
      ['pln', 115_000, 115_000],
    ])
    expect(report).toMatchObject({ date: '2026-10-15', currency: 'PLN', totalBase: 181_000, complete: true })
  })

  it('the arrival reads of a day are counted before the first read: a refusal over the cap reads no document', async () => {
    // A transfer paid on 3 October arrives in the window of 1 October (7 days either side): one arrival read for the EUR account.
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'transfer', accountId: 'pln', toAccountId: 'eur', amountMinor: 10_000, toAmountMinor: 2_500, paymentDate: '2026-10-03' }))
    await expect(readBalances(deps, ORG, '2026-10-01', { cap: 0 })).rejects.toMatchObject({ code: 'too_many_operations', cap: 0 })
    const { stats } = await readBalances(deps, ORG, '2026-10-01', { cap: 1 })
    expect(stats.reads).toBe(1)
  })

  it('a day after today is today: the balances of the account documents, no aggregate query', async () => {
    const { report, stats } = await readBalances(deps, ORG, '2026-12-31')
    expect(report.date).toBe(TODAY)
    expect(report.accounts.map((a) => [a.accountId, a.balanceMinor])).toEqual([
      ['eur', 25_000],
      ['pln', 72_000],
    ])
    expect(stats.aggregates).toBe(0)
  })
})

describe('the dashboard «Гроші зараз» (S12)', () => {
  it('the balances of today, the total in PLN by currency, the last bank sync of an active link', async () => {
    await db.doc(`organizations/${ORG}/bankAccounts/ba1`).set({ connectionId: 'c1', ebAccountUid: 'u1', accountId: 'pln', currency: 'PLN', importFrom: '2026-07-01', status: 'active', lastSyncAt: '2026-10-27T08:00:00.000Z' })
    await db.doc(`organizations/${ORG}/bankAccounts/ba0`).set({ connectionId: 'c0', ebAccountUid: 'u0', accountId: 'pln', currency: 'PLN', importFrom: '2026-01-01', status: 'disconnected', lastSyncAt: '2026-10-27T09:00:00.000Z' })
    const { report } = await readDashboard(deps, ORG)
    expect(report).toMatchObject({ date: TODAY, totalBase: 182_000, complete: true })
    expect(report.byCurrency).toEqual([
      { currency: 'PLN', balanceMinor: 72_000, baseMinor: 72_000, rate: null },
      { currency: 'EUR', balanceMinor: 25_000, baseMinor: 110_000, rate: { rate: 4.4, rateDate: '2026-10-27', tableNo: 'T/2026-10-28', final: false } },
    ])
    expect(report.bank).toEqual([{ accountId: 'pln', lastSyncAt: '2026-10-27T08:00:00.000Z' }])
  })
})
