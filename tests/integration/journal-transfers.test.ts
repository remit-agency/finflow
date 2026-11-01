// tests/integration/journal-transfers.test.ts
import { Timestamp } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, type JournalFilters } from '@/lib/domain/journal/filter'
import { compareKeys, decodeCursor, type JournalKey } from '@/lib/domain/journal/order'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { datedEffects } from '@/lib/domain/ledger/effects'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { readJournalPage } from '@/lib/server/journal/read'
import { makeTransfer } from '@/lib/server/ledger/transfer'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { ORG, clearFirestore, makeDeps, seedAccount, seedOrg, testDb, UID } from './helpers'
import { KEY, importBankOp, type BankOp } from './transfer-helpers'

const db = testDb()
let tick = 0
// Every write one second later: the creation times order the operations inside a day.
const deps = makeDeps(db, { now: () => new Date(Date.UTC(2026, 9, 27, 10, 0, 0) + ++tick * 1000) })

interface Stored { tx: LedgerTransaction; key: JournalKey }

async function allStored(): Promise<Stored[]> {
  const snap = await db.collection(`organizations/${ORG}/transactions`).get()
  const out: Stored[] = []
  for (const d of snap.docs) {
    const tx = parseTransaction(d.id, d.data())
    const created = d.get('createdAt') as Timestamp
    if (tx) out.push({ tx, key: { paymentDate: tx.paymentDate, createdAtS: created.seconds, createdAtN: created.nanoseconds, id: d.id } })
  }
  return out.sort((a, b) => compareKeys(a.key, b.key))
}

/**
 * The oracle: every movement of every account on its own day (S10b: the money in of a transfer on its arrival day), in the
 * listing order inside the day; each operation gets the balance of its own account right after its movement there.
 */
async function expectedBalances(stored: Stored[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>()
  for (const d of (await db.collection(`organizations/${ORG}/accounts`).get()).docs) {
    const a = parseAccount(d.id, d.data())
    if (a) balances.set(a.id, a.openingMinor)
  }
  const moves = stored.flatMap(({ tx, key }) => datedEffects(tx).map((e) => ({ tx, e, key: { ...key, paymentDate: e.day } })))
  moves.sort((a, b) => compareKeys(b.key, a.key)) // oldest first
  const after = new Map<string, number>()
  for (const { tx, e } of moves) {
    balances.set(e.accountId, (balances.get(e.accountId) ?? 0) + e.delta)
    if (e.accountId === tx.accountId) after.set(tx.id, balances.get(e.accountId) as number)
  }
  return after
}

async function readAll(filters: JournalFilters, limit: number) {
  const rows: Awaited<ReturnType<typeof readJournalPage>>['rows'] = []
  let cursor: JournalKey | null = null
  let guard = 0
  do {
    const page = await readJournalPage(deps, ORG, { filters, cursor, limit })
    rows.push(...page.rows)
    cursor = page.next === null ? null : decodeCursor(page.next)
    if (++guard > 200) throw new Error('the cursor never ends')
  } while (cursor)
  return rows
}

const OPS: BankOp[] = [
  { key: KEY(1), type: 'income', accountId: 'mono', amountMinor: 30_000, paymentDate: '2026-10-12' },
  { key: KEY(2), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' },
  { key: KEY(3), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-14' },
  { key: KEY(4), type: 'expense', accountId: 'mono', amountMinor: 5_000, paymentDate: '2026-10-13' },
  { key: KEY(5), type: 'expense', accountId: 'mono', amountMinor: 2_000, paymentDate: '2026-10-14' },
  { key: KEY(10), type: 'expense', accountId: 'mono', amountMinor: 700, paymentDate: '2026-10-15' },
  { key: KEY(7), type: 'income', accountId: 'mil', amountMinor: 40_000, paymentDate: '2026-10-16' },
  { key: KEY(8), type: 'income', accountId: 'mono', amountMinor: 1_000, paymentDate: '2026-10-16' },
  { key: KEY(6), type: 'expense', accountId: 'mono', amountMinor: 40_000, paymentDate: '2026-10-17' },
  { key: KEY(9), type: 'expense', accountId: 'mil', amountMinor: 3_000, paymentDate: '2026-10-18' },
]

beforeEach(async () => {
  tick = 0
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 50_000)
  for (const op of OPS) await importBankOp(db, deps, op)
  // mil → mono left on 10-12 and arrived on 10-14; mono → mil left on 10-17 and arrived the day before.
  await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [`bk_${KEY(2)}`, `bk_${KEY(3)}`] })
  await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [`bk_${KEY(6)}`, `bk_${KEY(7)}`] })
})

describe('the balance after each journal row with transfers that arrived on another day (S10b)', () => {
  it.each([1, 2, 3, 50])('pages of %i rows over every account', async (limit) => {
    const stored = await allStored()
    const oracle = await expectedBalances(stored)
    const rows = await readAll(EMPTY_FILTERS, limit)
    expect(rows.map((r) => r.tx.id)).toEqual(stored.map((s) => s.tx.id))
    for (const row of rows) expect(row.balanceAfterMinor, `${row.tx.id} at ${limit}`).toBe(oracle.get(row.tx.id))
  })

  it.each([1, 2, 5])('pages of %i rows of the receiving account', async (limit) => {
    const stored = await allStored()
    const oracle = await expectedBalances(stored)
    const rows = await readAll({ ...EMPTY_FILTERS, accountId: 'mono' }, limit)
    expect(rows.map((r) => r.tx.id)).toEqual(stored.filter((s) => s.tx.accountId === 'mono' || s.tx.toAccountId === 'mono').map((s) => s.tx.id))
    for (const row of rows) expect(row.balanceAfterMinor, `${row.tx.id} at ${limit}`).toBe(oracle.get(row.tx.id))
  })

  it('the newest row of each account shows its balance, and the ledger verifies', async () => {
    const rows = await readAll(EMPTY_FILTERS, 50)
    for (const accountId of ['mil', 'mono']) {
      const newest = rows.find((r) => r.tx.accountId === accountId)
      const stored = await db.doc(`organizations/${ORG}/accounts/${accountId}`).get()
      expect(newest?.balanceAfterMinor, accountId).toBe(stored.get('balanceMinor'))
    }
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
