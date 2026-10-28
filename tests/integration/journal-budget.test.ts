// tests/integration/journal-budget.test.ts
import { Timestamp } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_FILTERS } from '@/lib/domain/journal/filter'
import { compareKeys, type JournalKey } from '@/lib/domain/journal/order'
import { transactionToDoc } from '@/lib/domain/ledger/doc'
import { addDays } from '@/lib/domain/ledger/days'
import { balanceEffects } from '@/lib/domain/ledger/effects'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { readJournalPage } from '@/lib/server/journal/read'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)
const N = 10_000
const ACCOUNTS = ['b1', 'b2', 'b3']
const OPENING = 1_000_000

const ops: { tx: LedgerTransaction; key: JournalKey }[] = []

beforeAll(async () => {
  await clearFirestore()
  await seedOrg(db)
  for (const id of ACCOUNTS) await seedAccount(db, ORG, id, 'PLN', OPENING)

  const first = '2025-09-01'
  for (let i = 0; i < N; i++) {
    const day = addDays(first, Math.floor(i / 25)) // 25 operations a day, 400 days, all before TODAY
    const tx: LedgerTransaction = {
      id: `tx${String(i).padStart(5, '0')}`,
      type: i % 3 === 0 ? 'income' : 'expense',
      status: 'actual',
      accountId: ACCOUNTS[i % 3],
      amountMinor: 100 + (i % 997),
      currency: 'PLN',
      paymentDate: day,
      accrual: { mode: 'date', date: day },
      isRecurring: false,
      tags: [],
      fileUrls: [],
    }
    ops.push({ tx, key: { paymentDate: day, createdAtS: 1_790_000_000 + i, createdAtN: 0, id: tx.id } })
  }
  for (let i = 0; i < N; i += 400) {
    const batch = db.batch()
    for (const { tx, key } of ops.slice(i, i + 400)) {
      batch.set(db.doc(`organizations/${ORG}/transactions/${tx.id}`), {
        ...transactionToDoc(tx),
        orgId: ORG,
        createdAt: new Timestamp(key.createdAtS, 0),
        updatedAt: new Timestamp(key.createdAtS, 0),
        createdBy: UID,
        updatedBy: UID,
      })
    }
    await batch.commit()
  }
  await rebuildLedger(deps, ORG, UID, { apply: true })
}, 240_000)

describe('journal read budget at 10 000 operations', () => {
  it('a page deep in the history reads about a page of documents, with true balances', async () => {
    const sorted = [...ops].sort((a, b) => compareKeys(a.key, b.key))
    // Balance after each operation, from the oracle (oldest to newest).
    const running = new Map(ACCOUNTS.map((a) => [a, OPENING]))
    const after = new Map<string, number>()
    for (const { tx } of [...sorted].reverse()) {
      for (const [account, delta] of Object.entries(balanceEffects(tx))) running.set(account, (running.get(account) ?? 0) + delta)
      after.set(tx.id, running.get(tx.accountId) as number)
    }

    for (const at of [0, 5000, 9900]) {
      const cursor = at === 0 ? null : sorted[at - 1].key
      const page = await readJournalPage(deps, ORG, { filters: EMPTY_FILTERS, cursor, limit: 50 })
      expect(page.rows.map((r) => r.tx.id)).toEqual(sorted.slice(at, at + 50).map((s) => s.tx.id))
      for (const row of page.rows) expect(row.balanceAfterMinor, `${row.tx.id} at ${at}`).toBe(after.get(row.tx.id))
      // 50 rows + the operations of the (two or three) days they span, per account; never the 10 000.
      expect(page.stats.docsRead, `docs at ${at}`).toBeLessThanOrEqual(200)
      // Three sum queries (money in, money out, transfers in) per account: Firestore cannot sum over a range of rollup ids.
      expect(page.stats.aggregates, `aggregates at ${at}`).toBeLessThanOrEqual(3 * ACCOUNTS.length)
    }
  }, 120_000)
})
