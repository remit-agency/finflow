import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { parseSeriesInput } from '@/lib/domain/recurring/input'
import { createSeries } from '@/lib/server/ledger/series'
import { createTransaction } from '@/lib/server/ledger/write'
import { CRON_MAX_SERIES } from '@/lib/domain/recurring/types'
import { runRecurringCron } from '@/lib/server/recurring/cron'
import { readMatchSuggestions, readOverview } from '@/lib/server/recurring/read'
import { ORG, UID, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedOrg, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const on = (today: string) => makeDeps(db, { today: () => today })
// TODAY is 2026-10-27.
const rent = (dayOfMonth: number) =>
  parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth, startDate: '2026-10-01', categoryId: 'rent' })

async function planned(paymentDate: string, type: 'income' | 'expense', amountMinor: number) {
  return createTransaction(deps, ORG, UID, parseTransactionInput({ type, status: 'planned', accountId: 'mil', amountMinor, paymentDate }))
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedCategory(db, ORG, 'rent', 'expense')
})

describe('the overview (S11)', () => {
  it('counts the overdue, sums the next 7 days and gives each series its next date', async () => {
    const { series } = await createSeries(deps, ORG, UID, rent(10))
    const overdue = await planned('2026-10-20', 'expense', 5_000)
    await planned('2026-10-30', 'income', 70_000)
    const o = await readOverview(deps, ORG)
    expect(o.overdueCount).toBe(1)
    expect(o.overdue.map((r) => r.id)).toEqual([overdue.transaction.id])
    expect(o.soon).toEqual({ income: [{ currency: 'PLN', amountMinor: 70_000 }], expense: [] })
    expect(o.upcoming.map((r) => r.paymentDate)).toEqual(['2026-10-30', '2026-11-10'])
    expect(o.series).toMatchObject([{ id: series.id, name: 'Czynsz', next: '2026-11-10' }])
    expect(o.truncated).toBe(false)
  })
})

describe('the match suggestions', () => {
  it('offers the one plan of the days around a bank operation, with the series name', async () => {
    await createSeries(deps, ORG, UID, rent(27))
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-26' })
    const r = await readMatchSuggestions(deps, ORG)
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0]).toMatchObject({ plan: { occurrence: '2026-10-27', name: 'Czynsz' }, bank: { id: `bk_${KEY(1)}`, paymentDate: '2026-10-26' } })
    expect(r).toMatchObject({ total: 1, ambiguous: 0, truncated: false })
  })

  it('offers nothing for two equal bank operations, and reads no bank operation when no plan is near', async () => {
    await createSeries(deps, ORG, UID, rent(27))
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-26' })
    await importBankOp(db, deps, { key: KEY(2), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-25' })
    expect(await readMatchSuggestions(deps, ORG)).toMatchObject({ pairs: [], ambiguous: 1 })
    await clearFirestore()
    await seedOrg(db)
    await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
    await createSeries(deps, ORG, UID, { ...rent(10), categoryId: undefined })
    expect(await readMatchSuggestions(deps, ORG)).toMatchObject({ pairs: [], plansRead: 0, banksRead: 0 })
  })
})

describe('the daily run', () => {
  it('fills the due series of every company; a broken one is reported and waits a day; the others go on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await seedOrg(db, 'org2')
    await seedAccount(db, 'org2', 'acc2', 'PLN', 0)
    await createSeries(deps, ORG, UID, rent(10))
    await createSeries(deps, 'org2', UID, parseSeriesInput({ name: 'Netflix', kind: 'expense', accountId: 'acc2', amountMinor: 6_000, frequency: 'monthly', dayOfMonth: 5, startDate: '2026-10-01' }))
    await db.doc(`organizations/${ORG}/recurring/broken`).set({ schemaVersion: 1, dueOn: '2026-10-01' })
    const summary = await runRecurringCron(() => on('2026-11-27'),{ budgetMs: 10_000 })
    expect(summary).toEqual({ considered: 3, filled: 2, created: 2, skipped: 0, failed: 1 })
    expect(await readDoc(db, `organizations/${ORG}/recurring/broken`)).toMatchObject({ dueOn: '2026-11-28' })
    expect(await runRecurringCron(() => on('2026-11-27'),{ budgetMs: 10_000 })).toEqual({ considered: 0, filled: 0, created: 0, skipped: 0, failed: 0 })
  })

  it('reads at most CRON_MAX_SERIES due series a run; the rest waits for the next call (MINOR c)', async () => {
    const batch = db.batch()
    for (let i = 0; i < CRON_MAX_SERIES + 1; i++) batch.set(db.doc(`organizations/${ORG}/recurring/due${i}`), { schemaVersion: 1, dueOn: '2026-10-01' })
    await batch.commit()
    const summary = await runRecurringCron(() => on('2026-11-27'), { budgetMs: 60_000 })
    expect(summary.considered).toBe(CRON_MAX_SERIES)
    expect(summary.filled + summary.skipped + summary.failed).toBe(CRON_MAX_SERIES)
    // The 200 read were moved to tomorrow (they fail: no series fields); the one not read is still due today.
    expect((await db.collectionGroup('recurring').where('dueOn', '<=', '2026-11-27').get()).size).toBe(1)
  })

  it('does nothing without time left; the next call catches up', async () => {
    await createSeries(deps, ORG, UID, rent(10))
    expect(await runRecurringCron(() => on('2026-11-27'),{ budgetMs: 0 })).toEqual({ considered: 0, filled: 0, created: 0, skipped: 0, failed: 0 })
    expect(await runRecurringCron(() => on('2026-11-27'),{ budgetMs: 10_000 })).toMatchObject({ filled: 1, created: 1 })
  })
})
