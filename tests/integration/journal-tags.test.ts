import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, NO_TAG, type JournalFilters } from '@/lib/domain/journal/filter'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { readJournalPage } from '@/lib/server/journal/read'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedCategory, seedOrg, seedTag, testDb } from './helpers'

const db = testDb()
let tick = 0
// Every write gets a later createdAt, so the listing order inside a day is the creation order.
const deps = makeDeps(db, { now: () => new Date(Date.UTC(2026, 9, 27, 10, 0, 0) + ++tick * 1000) })

const write = async (extra: Record<string, unknown>) =>
  (await createTransaction(deps, ORG, UID, parseTransactionInput({ accountId: 'a1', ...extra }))).transaction.id

let ids: { inc1: string; vat: string; q: string; inc2: string }

beforeEach(async () => {
  tick = 0
  await clearFirestore()
  await seedOrg(db)
  await seedCategory(db, ORG, 'k-in', 'income')
  await seedCategory(db, ORG, 'k-ex', 'expense')
  await seedAccount(db, ORG, 'a1', 'PLN', 100_000)
  await seedTag(db, ORG, 'vat', { excludeFromAnalytics: true })
  await seedTag(db, ORG, 'q4')
  ids = {
    inc1: await write({ type: 'income', amountMinor: 10_000, paymentDate: '2026-10-05', categoryId: 'k-in' }),
    vat: await write({ type: 'expense', amountMinor: 2_300, paymentDate: '2026-10-10', categoryId: 'k-ex', tags: ['vat'] }),
    q: await write({ type: 'expense', amountMinor: 1_000, paymentDate: '2026-10-12', categoryId: 'k-ex', tags: ['q4'] }),
    inc2: await write({ type: 'income', amountMinor: 5_000, paymentDate: '2026-10-15', categoryId: 'k-in' }),
  }
})

async function rowsFor(patch: Partial<JournalFilters>) {
  return (await readJournalPage(deps, ORG, { filters: { ...EMPTY_FILTERS, ...patch }, cursor: null, limit: 50 })).rows
}

describe('the journal and tags (S10t)', () => {
  it('tg and ex select in memory; _none finds the operations without tags', async () => {
    const idsOf = async (patch: Partial<JournalFilters>) => (await rowsFor(patch)).map((r) => r.tx.id)
    expect(await idsOf({ tagIds: ['vat'] })).toEqual([ids.vat])
    expect(await idsOf({ tagIds: ['vat', 'q4'] })).toEqual([ids.q, ids.vat])
    expect(await idsOf({ tagIds: [NO_TAG] })).toEqual([ids.inc2, ids.inc1])
    expect(await idsOf({ tagIds: [NO_TAG, 'q4'] })).toEqual([ids.inc2, ids.q, ids.inc1])
    expect(await idsOf({ excludedOnly: true })).toEqual([ids.vat])
  })

  it('the balance after a row counts an excluded operation on a day between the days of the page', async () => {
    // The page shows the two incomes (15th and 5th); between them the excluded expense (10th, an x_cash_ day) and the q4 one.
    const rows = await rowsFor({ types: ['income'] })
    expect(rows.map((r) => [r.tx.id, r.balanceAfterMinor])).toEqual([
      [ids.inc2, 100_000 + 10_000 - 2_300 - 1_000 + 5_000],
      [ids.inc1, 100_000 + 10_000],
    ])
  })
})
