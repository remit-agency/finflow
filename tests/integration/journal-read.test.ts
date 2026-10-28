// tests/integration/journal-read.test.ts
import { Timestamp } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, matchesFilters, type JournalFilters } from '@/lib/domain/journal/filter'
import { compareKeys, decodeCursor, type JournalKey } from '@/lib/domain/journal/order'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { balanceEffects } from '@/lib/domain/ledger/effects'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { readJournalPage, readOneTransaction } from '@/lib/server/journal/read'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'

const db = testDb()
let tick = 0
// Every write gets a later createdAt, so the listing order inside a day is the creation order.
const deps = makeDeps(db, { now: () => new Date(Date.UTC(2026, 9, 27, 10, 0, 0) + ++tick * 1000) })

/** A small deterministic generator: the same operations on every run. */
function lcg(seed: number): () => number {
  let s = seed
  return () => (s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648
}

const DAY = (n: number) => `2026-10-${String(n).padStart(2, '0')}`

async function seedScenario(): Promise<void> {
  const rnd = lcg(7)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  for (let i = 0; i < 90; i++) {
    const day = DAY(1 + Math.floor(rnd() * 20))
    const kind = rnd()
    const base = { paymentDate: day, amountMinor: 100 + Math.floor(rnd() * 90_000) }
    let input: Record<string, unknown>
    if (kind < 0.35) input = { ...base, type: 'expense', accountId: pick(['a1', 'a2', 'a3']), categoryId: 'k-ex', counterpartyId: pick(['cp1', 'cp2']), description: pick(['Czynsz', 'Faktura za prąd', 'Łódź dostawa']) }
    else if (kind < 0.65) input = { ...base, type: 'income', accountId: pick(['a1', 'a2', 'a3']), categoryId: 'k-in', description: pick(['Sprzedaż', 'Zaliczka']) }
    else if (kind < 0.8) input = { ...base, type: 'transfer', accountId: 'a1', toAccountId: 'a3' }
    else if (kind < 0.88) input = { ...base, type: 'transfer', accountId: 'a1', toAccountId: 'a2', toAmountMinor: Math.max(1, Math.floor(base.amountMinor / 4)) }
    else if (kind < 0.94) input = { ...base, type: 'expense', accountId: 'a1', paymentDate: '2026-11-05', status: 'planned', counterpartyId: 'cp1' }
    else input = { ...base, type: 'expense', accountId: 'a3', accrual: { mode: 'period', from: '2026-09-01', to: '2026-12-31' } }
    await createTransaction(deps, ORG, UID, parseTransactionInput(input))
  }
}

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

/** The oracle: running balance per account over the operations from oldest to newest. */
async function expectedBalances(stored: Stored[]): Promise<Map<string, number>> {
  const accounts = new Map<string, number>()
  for (const d of (await db.collection(`organizations/${ORG}/accounts`).get()).docs) {
    const a = parseAccount(d.id, d.data())
    if (a) accounts.set(a.id, a.openingMinor)
  }
  const after = new Map<string, number>()
  for (const { tx } of [...stored].reverse()) {
    if (tx.status !== 'actual') continue
    for (const [account, delta] of Object.entries(balanceEffects(tx))) accounts.set(account, (accounts.get(account) ?? 0) + delta)
    after.set(tx.id, accounts.get(tx.accountId) as number)
  }
  return after
}

async function readAll(filters: JournalFilters, limit = 13) {
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

beforeEach(async () => {
  tick = 0
  await clearFirestore()
  await seedOrg(db)
  await seedCategory(db, ORG, 'k-ex', 'expense')
  await seedCategory(db, ORG, 'k-in', 'income')
  await seedCounterparty(db, ORG, 'cp1')
  await seedCounterparty(db, ORG, 'cp2')
  await seedAccount(db, ORG, 'a1', 'PLN', 500_000)
  await seedAccount(db, ORG, 'a2', 'EUR', 100_000)
  await seedAccount(db, ORG, 'a3', 'PLN', 0)
  await seedAccount(db, ORG, 'a10', 'PLN', 7_000) // a1 / a10: the rollup id range of a1 must not swallow a10
  await seedScenario()
  await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'a10', amountMinor: 500, paymentDate: DAY(3) }))
})

describe('readJournalPage', () => {
  it('pages through everything once, in listing order, with the balance after each operation', async () => {
    const stored = await allStored()
    const oracle = await expectedBalances(stored)
    const rows = await readAll(EMPTY_FILTERS)

    expect(rows.map((r) => r.tx.id)).toEqual(stored.map((s) => s.tx.id))
    for (const row of rows) {
      expect(row.balanceAfterMinor, row.tx.id).toBe(row.tx.status === 'actual' ? oracle.get(row.tx.id) : null)
    }
  })

  it("the newest actual operation of an account shows the account's balance", async () => {
    const rows = await readAll(EMPTY_FILTERS)
    for (const accountId of ['a1', 'a2', 'a3', 'a10']) {
      const newest = rows.find((r) => r.tx.accountId === accountId && r.tx.status === 'actual')
      const stored = await db.doc(`organizations/${ORG}/accounts/${accountId}`).get()
      expect(newest?.balanceAfterMinor, accountId).toBe(stored.get('balanceMinor'))
    }
  })

  const FILTERS: [string, Partial<JournalFilters>][] = [
    ['type', { types: ['transfer'] }],
    ['planned', { status: 'planned' }],
    ['text', { q: 'lodz' }],
    ['text on a counterparty and a comment', { q: 'cp1 prad' }],
    ['amount range', { minMinor: 20_000, maxMinor: 60_000 }],
    ['the account filter includes transfers into it', { accountId: 'a3' }],
    ['payment range', { from: DAY(5), to: DAY(9) }],
    ['accrual range reaches a period', { basis: 'accrual', from: '2026-12-01', to: '2026-12-31' }],
    ['category and counterparty', { categoryIds: ['k-ex'], counterpartyIds: ['cp1'] }],
  ]

  it.each(FILTERS)('filter: %s returns what the predicate selects, balances still true', async (_name, patch) => {
    const filters: JournalFilters = { ...EMPTY_FILTERS, ...patch }
    const stored = await allStored()
    const oracle = await expectedBalances(stored)
    const names = new Map([['a1', 'a1'], ['a2', 'a2'], ['a3', 'a3'], ['a10', 'a10']])
    const cps = new Map([['cp1', 'cp1'], ['cp2', 'cp2']])
    const ctx = { accountName: (id: string) => names.get(id), counterpartyName: (id: string) => cps.get(id) }
    const expected = stored.filter((s) => matchesFilters(s.tx, filters, ctx)).map((s) => s.tx.id)

    const rows = await readAll(filters)
    expect(rows.map((r) => r.tx.id)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.balanceAfterMinor).toBe(row.tx.status === 'actual' ? oracle.get(row.tx.id) : null)
  })

  // If a filter above selects nothing with this seed, change the seed constant in `lcg(7)`; do not weaken the filter.
  it('a scan that hits its cap returns a short page and a cursor, and the pages still add up', async () => {
    const filters: JournalFilters = { ...EMPTY_FILTERS, q: 'sprzedaz' }
    let cursor: JournalKey | null = null
    const found: string[] = []
    let pages = 0
    do {
      const page = await readJournalPage(deps, ORG, { filters, cursor, limit: 50, scanCap: 20 })
      found.push(...page.rows.map((r) => r.tx.id))
      cursor = page.next === null ? null : decodeCursor(page.next)
      pages++
    } while (cursor)
    const expected = (await readAll(filters)).map((r) => r.tx.id)
    expect(found).toEqual(expected)
    expect(pages).toBeGreaterThan(1)
  })
})

describe('readOneTransaction', () => {
  beforeEach(async () => {
    await clearFirestore()
    await seedOrg(db)
    await seedAccount(db, ORG, 'a1', 'PLN', 0)
  })

  it('returns the operation as it is stored now', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'a1', amountMinor: 4_200, paymentDate: '2026-10-20', description: 'Zaliczka' }))
    const one = await readOneTransaction(deps, ORG, transaction.id)
    expect(one).toMatchObject({ id: transaction.id, type: 'income', amountMinor: 4_200, description: 'Zaliczka' })
    await db.doc(`organizations/${ORG}/transactions/${transaction.id}`).update({ description: 'Zmienione' })
    expect((await readOneTransaction(deps, ORG, transaction.id))?.description).toBe('Zmienione')
  })

  it('returns null for a missing document', async () => {
    expect(await readOneTransaction(deps, ORG, 'nope')).toBeNull()
  })

  it('returns null for a document that is not a ledger v2 operation', async () => {
    await db.doc(`organizations/${ORG}/transactions/legacy1`).set({ amount: 12.5, note: 'old shape' })
    expect(await readOneTransaction(deps, ORG, 'legacy1')).toBeNull()
  })
})

describe('documents the listing cannot place', () => {
  const mk = async (over: Record<string, unknown>) =>
    (await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'a1', amountMinor: 1_000, paymentDate: '2026-10-20', ...over }))).transaction.id

  beforeEach(async () => {
    await clearFirestore()
    await seedOrg(db)
    await seedAccount(db, ORG, 'a1', 'PLN', 0)
  })

  /** Pages with `limit` through the cursors until the end; a stuck read fails the test instead of hanging it. */
  async function pageAll(limit: number): Promise<string[]> {
    const ids: string[] = []
    let cursor: JournalKey | null = null
    for (let i = 0; i < 50; i++) {
      const page = await readJournalPage(deps, ORG, { filters: EMPTY_FILTERS, cursor, limit })
      ids.push(...page.rows.map((r) => r.tx.id))
      if (page.next === null) return ids
      cursor = decodeCursor(page.next)
    }
    throw new Error('the listing did not end')
  }

  it('a document without a string payment date is skipped and does not stall a one-row page', async () => {
    const a = await mk({ paymentDate: '2026-10-21' })
    const b = await mk({ paymentDate: '2026-10-20' })
    await db.doc(`organizations/${ORG}/transactions/${await mk({})}`).update({ paymentDate: 20_261_020 })
    expect(await pageAll(1)).toEqual([a, b])
    expect(await pageAll(100)).toEqual([a, b])
  })

  it('a document whose creation time is not a timestamp is still listed, in one request', async () => {
    const a = await mk({ paymentDate: '2026-10-21' })
    const odd = await mk({ paymentDate: '2026-10-20' })
    const c = await mk({ paymentDate: '2026-10-20' })
    await db.doc(`organizations/${ORG}/transactions/${odd}`).update({ createdAt: 'yesterday' })
    const page = await readJournalPage(deps, ORG, { filters: EMPTY_FILTERS, cursor: null, limit: 100 })
    expect(page.rows.map((r) => r.tx.id).sort()).toEqual([a, odd, c].sort())
    expect(page.next).toBeNull()
  })
})
