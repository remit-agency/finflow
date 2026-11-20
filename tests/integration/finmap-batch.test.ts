import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import type { BatchOp } from '@/lib/domain/import/finmap/request'
import { addDays } from '@/lib/domain/ledger/days'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { ImportError } from '@/lib/server/imports/errors'
import { finmapBatch } from '@/lib/server/imports/finmap/batch'
import { finmapCheck } from '@/lib/server/imports/finmap/check'
import { finmapKey, finmapTxId } from '@/lib/server/imports/finmap/key'
import { acquireLock, releaseLock } from '@/lib/server/ledger/lock'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { FxError } from '@/lib/server/fx/types'
import { ORG, UID, balanceOf, clearFirestore, fakeResolveRate, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, seedTag, testDb } from './helpers'

const db = testDb()
const NOW = new Date('2026-10-27T10:00:00Z')
const ORG2 = 'org-single'
const IMPORT = 'imp1'

function depsFor(over: Partial<LedgerDeps> = {}): ImportDeps {
  const ledger = makeDeps(db, { now: () => NOW, ...over })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

const col = (orgId: string, name: string) => `organizations/${orgId}/${name}`

/** A batch operation of the test company; each test changes what it needs. */
function op(n: number, over: Partial<BatchOp> = {}): BatchOp {
  return {
    kind: 'expense',
    status: 'actual',
    day: addDays('2026-09-01', n % 30),
    amountMinor: 1000 + n * 37,
    accountId: 'pln1',
    toAccountId: null,
    toAmountMinor: null,
    categoryId: 'exp',
    counterpartyId: null,
    tagIds: [],
    description: null,
    accrual: null,
    identity: [`row-${n}`],
    ordinal: 0,
    ...over,
  }
}

const keyOf = (o: BatchOp): string => finmapKey(o.accountId, o.toAccountId, o.identity, o.ordinal)
const txPath = (orgId: string, key: string) => `${col(orgId, 'transactions')}/${finmapTxId(key)}`

/** The body the ledger's own create takes for the same operation: the reference the batch must match. */
function singleBody(o: BatchOp, key: string): Record<string, unknown> {
  return {
    clientId: finmapTxId(key),
    type: o.kind,
    status: o.status,
    accountId: o.accountId,
    amountMinor: o.amountMinor,
    paymentDate: o.day,
    ...(o.toAccountId === null ? {} : { toAccountId: o.toAccountId }),
    ...(o.toAmountMinor === null ? {} : { toAmountMinor: o.toAmountMinor }),
    ...(o.accrual === null ? {} : { accrual: { mode: 'period', from: o.accrual.from, to: o.accrual.to } }),
    ...(o.categoryId === null ? {} : { categoryId: o.categoryId }),
    ...(o.counterpartyId === null ? {} : { counterpartyId: o.counterpartyId }),
    ...(o.description === null ? {} : { description: o.description }),
    tags: o.tagIds,
  }
}

/** A company with three accounts (two PLN, one EUR), categories with a child, a counterparty and two tags (one excluded). */
async function seedCompany(orgId: string): Promise<void> {
  await seedOrg(db, orgId)
  await seedAccount(db, orgId, 'pln1', 'PLN', 1000)
  await seedAccount(db, orgId, 'pln2', 'PLN', 0)
  await seedAccount(db, orgId, 'eur1', 'EUR', 0)
  await seedCategory(db, orgId, 'inc', 'income')
  await seedCategory(db, orgId, 'inc-sub', 'income')
  await db.doc(`${col(orgId, 'categories')}/inc-sub`).update({ parentId: 'inc' })
  await seedCategory(db, orgId, 'exp', 'expense')
  await seedCounterparty(db, orgId, 'cp1')
  await seedTag(db, orgId, 't-excl', { excludeFromAnalytics: true })
  await seedTag(db, orgId, 't-plain')
  await seedImport(orgId, IMPORT)
}

/** An import document as the Finmap setup writes it. */
async function seedImport(orgId: string, id: string, kind: 'finmap' | 'mt940' = 'finmap', status: 'applied' | 'undone' = 'applied'): Promise<void> {
  await db.doc(`${col(orgId, 'imports')}/${id}`).set({
    schemaVersion: 1,
    kind,
    fileName: 'synthetic.xlsx',
    accountIds: [],
    createdAt: Timestamp.fromDate(NOW),
    createdBy: UID,
    period: { from: null, to: null },
    counts: { created: 0, skipped: 0, refused: 0 },
    statements: [],
    fit: {},
    fitTargets: {},
    entities: { accounts: 0, categories: 0, counterparties: 0, tags: 0 },
    status,
    undo: { deleted: 0, kept: 0 },
  })
}

/** 30 operations of every kind the batch must handle: income and expense (foreign currency, tags, a child category), transfers, planned, accrual periods. */
function thirtyOps(): BatchOp[] {
  const ops: BatchOp[] = []
  for (let n = 0; n < 10; n++) {
    ops.push(op(n, {
      kind: 'income',
      accountId: n % 2 ? 'pln1' : 'eur1',
      categoryId: n % 2 ? 'inc-sub' : 'inc',
      counterpartyId: n % 3 === 0 ? 'cp1' : null,
      tagIds: n === 4 ? ['t-excl'] : [],
    }))
  }
  for (let n = 10; n < 20; n++) {
    ops.push(op(n, {
      accountId: n % 2 ? 'eur1' : 'pln1',
      tagIds: n === 12 ? ['t-plain', 't-excl'] : n % 3 === 0 ? ['t-excl'] : ['t-plain'],
    }))
  }
  ops.push(op(20, { kind: 'transfer', accountId: 'pln1', toAccountId: 'pln2', categoryId: null, amountMinor: 500 }))
  ops.push(op(21, { kind: 'transfer', accountId: 'eur1', toAccountId: 'pln1', categoryId: null, amountMinor: 2000, toAmountMinor: 9000 }))
  ops.push(op(22, { status: 'planned', day: '2026-12-05' }))
  ops.push(op(23, { kind: 'income', status: 'planned', day: '2026-12-06', accountId: 'pln2', categoryId: 'inc' }))
  ops.push(op(24, { accrual: { from: '2026-07-01', to: '2026-09-30' } }))
  ops.push(op(25, { kind: 'income', accountId: 'eur1', categoryId: 'inc-sub', accrual: { from: '2026-08-01', to: '2026-10-31' } }))
  for (let n = 26; n < 30; n++) {
    ops.push(op(n, { kind: n % 2 ? 'income' : 'expense', accountId: 'pln2', categoryId: n % 2 ? 'inc' : 'exp', counterpartyId: n === 26 ? 'cp1' : null, description: 'opis' }))
  }
  return ops
}

/** The stored operations of a company by id (the import, the ledger's own fields only, for comparisons). */
async function txsOf(orgId: string): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const d of (await db.collection(col(orgId, 'transactions')).get()).docs) out[d.id] = d.data()
  return out
}

/** Every rollup document of a company, by id. */
async function rollupsOf(orgId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const d of (await db.collection(col(orgId, 'rollups')).get()).docs) out[d.id] = d.data()
  return out
}

async function balancesOf(orgId: string): Promise<Record<string, number>> {
  return { pln1: await balanceOf(db, orgId, 'pln1'), pln2: await balanceOf(db, orgId, 'pln2'), eur1: await balanceOf(db, orgId, 'eur1') }
}

/** The fields of an operation that the batch and a one-by-one write must agree on. */
function comparable(tx: Record<string, unknown>): Record<string, unknown> {
  const keys = ['type', 'status', 'accountId', 'amountMinor', 'paymentDate', 'toAccountId', 'toAmountMinor', 'categoryId', 'counterpartyId', 'tags', 'excluded', 'fx', 'base', 'accrual', 'currency']
  return Object.fromEntries(keys.filter((k) => tx[k] !== undefined).map((k) => [k, tx[k]]))
}

beforeEach(async () => {
  await clearFirestore()
  await seedCompany(ORG)
})

describe('finmapBatch', () => {
  it('writes the same balances, rollups, excluded flags and operations as writing one by one, and verifies clean', async () => {
    await seedCompany(ORG2)
    const ops = thirtyOps()
    const batch = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    expect(batch).toEqual({ created: 30, skipped: 0, refused: [] })

    const ledger2 = makeDeps(db, { now: () => NOW })
    for (const o of ops) {
      const key = keyOf(o)
      // The create of a Finmap id needs the mark the batch writes with the operation (its import link comes from it).
      await db.doc(`${col(ORG2, 'bankSeen')}/${key}`).set({ txId: finmapTxId(key), at: NOW.toISOString(), importId: IMPORT, kind: 'finmap' })
      await createTransaction(ledger2, ORG2, UID, parseTransactionInput(singleBody(o, key), { internal: true }))
    }

    expect(await balancesOf(ORG)).toEqual(await balancesOf(ORG2))
    expect(await rollupsOf(ORG)).toEqual(await rollupsOf(ORG2))

    const batchTxs = await txsOf(ORG)
    const singleTxs = await txsOf(ORG2)
    expect(Object.keys(batchTxs).sort()).toEqual(Object.keys(singleTxs).sort())
    for (const id of Object.keys(singleTxs)) {
      expect(comparable(batchTxs[id])).toEqual(comparable(singleTxs[id]))
      expect(batchTxs[id].importId).toBe(IMPORT)
      expect(singleTxs[id].importId).toBe(IMPORT)
    }
    // The mix really exercises the flag and the foreign rates.
    expect(Object.values(batchTxs).filter((t) => t.excluded === true).length).toBeGreaterThan(0)
    expect(Object.values(batchTxs).some((t) => t.fx !== undefined)).toBe(true)

    expect(await verifyLedger(makeDeps(db), ORG)).toMatchObject({ ok: true, transactions: 30, balanceDiffs: [], rollupDiffs: [], excludedDiffs: [] })
    expect(await verifyLedger(makeDeps(db), ORG2)).toMatchObject({ ok: true, balanceDiffs: [], rollupDiffs: [], excludedDiffs: [] })
  })

  it('widens the import period to the days of the operations it created, and leaves it alone when it creates none', async () => {
    const importPath = `${col(ORG, 'imports')}/${IMPORT}`
    expect((await readDoc(db, importPath))?.period).toEqual({ from: null, to: null })
    const ops = thirtyOps()
    const days = ops.map((o) => o.day).sort()
    await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    expect((await readDoc(db, importPath))?.period).toEqual({ from: days[0], to: days[days.length - 1] })

    const earlier = op(40, { day: '2025-01-02', identity: ['early'] })
    const later = op(41, { day: '2027-03-01', status: 'planned', identity: ['late'] })
    await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: [earlier, later] })
    expect((await readDoc(db, importPath))?.period).toEqual({ from: '2025-01-02', to: '2027-03-01' })

    const again = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: [earlier] })
    expect(again).toEqual({ created: 0, skipped: 1, refused: [] })
    expect((await readDoc(db, importPath))?.period).toEqual({ from: '2025-01-02', to: '2027-03-01' })
  })

  it('creates nothing when the same request comes again, and a deleted operation does not come back', async () => {
    const ops = thirtyOps()
    await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    const again = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    expect(again).toEqual({ created: 0, skipped: 30, refused: [] })

    const keys = ops.map(keyOf)
    expect(await finmapCheck(depsFor(), ORG, ops.map((o) => ({ accountId: o.accountId, toAccountId: o.toAccountId, identity: o.identity, ordinal: o.ordinal })))).toEqual({
      seen: keys.map(() => true),
    })

    await deleteTransaction(makeDeps(db), ORG, UID, finmapTxId(keys[0]))
    expect(await readDoc(db, txPath(ORG, keys[0]))).toBeUndefined()
    const third = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    expect(third).toEqual({ created: 0, skipped: 30, refused: [] })
    expect(await readDoc(db, txPath(ORG, keys[0]))).toBeUndefined()
  })

  it('splits 200 operations over 200 days into several transactions, all committed and clean', async () => {
    const days = Array.from({ length: 200 }, (_, i) => addDays('2026-01-01', i))
    const ops = days.map((day, i) => op(i, { day, amountMinor: 100 + i, identity: [`day-${i}`] }))
    const spy = vi.spyOn(db, 'runTransaction')
    let created = 0
    for (let i = 0; i < ops.length; i += 50) {
      const r = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops.slice(i, i + 50) })
      created += r.created
      expect(r.refused).toEqual([])
    }
    // At least one transaction per request, plus the step locks (two per account per request).
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4)
    spy.mockRestore()
    expect(created).toBe(200)
    expect(Object.keys(await txsOf(ORG))).toHaveLength(200)
    expect(await verifyLedger(makeDeps(db), ORG)).toMatchObject({ ok: true, transactions: 200, balanceDiffs: [], rollupDiffs: [] })
  })

  it('converts a foreign-currency operation through the rate evidence of the request, and stores it', async () => {
    await finmapBatch(depsFor(), ORG, UID, {
      importId: IMPORT,
      operations: [op(0, { kind: 'expense', accountId: 'eur1', categoryId: 'exp', amountMinor: 5000, day: '2026-10-01' })],
    })
    const tx = (await txsOf(ORG))[finmapTxId(keyOf(op(0, { accountId: 'eur1' })))]
    const fx = tx.fx as { payment: { rate: number; source: string; requestedDate: string } }
    expect(fx.payment).toMatchObject({ rate: 4.4, source: 'NBP_A', requestedDate: '2026-10-01' })
    expect(tx.base).toMatchObject({ payment: expect.any(Number) })
  })

  it('refuses a future actual day, a category of the wrong type and an unknown account, and writes the rest', async () => {
    const ops = [
      op(0, { day: '2026-11-01' }),
      op(1, { kind: 'income', categoryId: 'exp' }),
      op(2, { accountId: 'nope' }),
      op(3, { day: '2026-10-02' }),
    ]
    const r = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    expect(r.created).toBe(1)
    expect(r.skipped).toBe(0)
    expect(r.refused).toEqual([
      { index: 0, reason: 'future_actual', field: 'paymentDate' },
      { index: 1, reason: 'category_not_found', field: 'categoryId' },
      { index: 2, reason: 'account_not_found', field: 'accountId' },
    ])
    const seen = await finmapCheck(depsFor(), ORG, ops.map((o) => ({ accountId: o.accountId, toAccountId: o.toAccountId, identity: o.identity, ordinal: o.ordinal })))
    expect(seen.seen).toEqual([false, false, false, true])
    expect((await readDoc(db, `${col(ORG, 'imports')}/${IMPORT}`))?.counts).toEqual({ created: 1, skipped: 0, refused: 3 })
  })

  it('refuses a plan beyond the ledger horizon with the ledger code, for the accrual and for the payment day', async () => {
    const ops = [
      op(0, { status: 'planned', day: '2036-10-01', accrual: { from: '2036-10-01', to: '2037-01-01' } }),
      op(1, { status: 'planned', day: '2036-12-01' }),
    ]
    const r = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    expect(r).toEqual({
      created: 0,
      skipped: 0,
      refused: [
        { index: 0, reason: 'invalid_input', field: 'accrual' },
        { index: 1, reason: 'invalid_input', field: 'paymentDate' },
      ],
    })
  })

  it('refuses archived counterparties and tags with the ledger codes, counts them, and un-archives nothing', async () => {
    await seedCounterparty(db, ORG, 'cp-old', { archived: true })
    await seedTag(db, ORG, 't-old', { archived: true })
    const ops = [op(0, { counterpartyId: 'cp-old' }), op(1, { tagIds: ['t-old'] }), op(2, { counterpartyId: 'cp1' })]
    const r = await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    expect(r).toEqual({
      created: 1,
      skipped: 0,
      refused: [
        { index: 0, reason: 'counterparty_archived', field: 'counterpartyId' },
        { index: 1, reason: 'tag_archived', field: 'tags' },
      ],
    })
    expect(await readDoc(db, `${col(ORG, 'counterparties')}/cp-old`)).toMatchObject({ archived: true })
    expect(await readDoc(db, `${col(ORG, 'tags')}/t-old`)).toMatchObject({ archived: true })
    expect((await readDoc(db, `${col(ORG, 'imports')}/${IMPORT}`))?.counts).toMatchObject({ refused: 2 })
  })

  it('refuses a row whose day has no rate as rate_unavailable on its payment date, and writes the rest', async () => {
    const fake = fakeResolveRate()
    const resolveRate: LedgerDeps['resolveRate'] = (from, to, date) => (date < '2002-01-01' ? Promise.reject(new FxError('no_rate_before')) : fake(from, to, date))
    const ops = [op(0, { accountId: 'eur1', day: '2001-06-01', identity: ['old'] }), op(1, { accountId: 'eur1', day: '2026-10-02' }), op(2)]
    const r = await finmapBatch(depsFor({ resolveRate }), ORG, UID, { importId: IMPORT, operations: ops })
    expect(r).toEqual({ created: 2, skipped: 0, refused: [{ index: 0, reason: 'rate_unavailable', field: 'paymentDate' }] })
    expect(await readDoc(db, txPath(ORG, keyOf(ops[0])))).toBeUndefined()
    expect((await readDoc(db, `${col(ORG, 'imports')}/${IMPORT}`))?.counts).toEqual({ created: 2, skipped: 0, refused: 1 })
  })

  it('fails the whole request as provider_unavailable when the rate provider is down, and writes nothing', async () => {
    const resolveRate: LedgerDeps['resolveRate'] = () => Promise.reject(new FxError('provider_unavailable'))
    // A refusal before the rate call must not be recorded either: the request wrote nothing.
    const ops = [op(0, { day: '2026-11-02' }), op(1, { accountId: 'eur1' })]
    await expect(finmapBatch(depsFor({ resolveRate }), ORG, UID, { importId: IMPORT, operations: ops })).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(Object.keys(await txsOf(ORG))).toHaveLength(0)
    expect((await readDoc(db, `${col(ORG, 'imports')}/${IMPORT}`))?.counts).toEqual({ created: 0, skipped: 0, refused: 0 })
  })

  it('rethrows the error of a failed write, not the error of recording its totals after it', async () => {
    // A refused operation makes the totals non-empty; the 2nd transaction (the group) and the 3rd (the totals) both fail.
    const original = db.runTransaction.bind(db)
    let calls = 0
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation(((fn: never, opts?: never) => {
      calls++
      if (calls === 2) return Promise.reject(new Error('the write failed'))
      if (calls === 3) return Promise.reject(new Error('recording failed'))
      return original(fn, opts)
    }) as never)
    try {
      await expect(finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: [op(0, { day: '2026-11-02' }), op(1)] })).rejects.toThrow('the write failed')
    } finally {
      spy.mockRestore()
    }
    // The step locks were freed by the request's own finally (the 4th transaction, not mocked).
    expect((await readDoc(db, `${col(ORG, 'importLocks')}/pln1`))?.until ?? 0).toBe(0)
  })

  it('throws ledger_busy and writes nothing while the ledger is locked', async () => {
    const token = await acquireLock(makeDeps(db), ORG, 'test')
    try {
      await expect(finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: thirtyOps().slice(0, 5) })).rejects.toMatchObject({ code: 'ledger_busy' })
    } finally {
      await releaseLock(makeDeps(db), ORG, token)
    }
    expect(Object.keys(await txsOf(ORG))).toHaveLength(0)
  })

  it('throws already_running on a held account lock, and frees the locks it took before', async () => {
    const future = NOW.getTime() + 60_000
    await db.doc(`${col(ORG, 'importLocks')}/pln1`).set({ until: future, token: 'someone-else' })
    const ops = [op(0, { accountId: 'eur1', kind: 'income', categoryId: 'inc' }), op(1, { accountId: 'pln1' })]
    await expect(finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })).rejects.toMatchObject({ code: 'already_running' })
    expect(Object.keys(await txsOf(ORG))).toHaveLength(0)
    expect((await readDoc(db, `${col(ORG, 'importLocks')}/eur1`))?.until ?? 0).toBe(0)
    expect((await readDoc(db, `${col(ORG, 'importLocks')}/pln1`))?.until).toBe(future)
  })

  it('takes the account locks of a request in one transaction and frees them in one, not one per account', async () => {
    const spy = vi.spyOn(db, 'runTransaction')
    try {
      await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: thirtyOps() })
      // Three accounts: one transaction takes the three locks, one writes the group, one records the totals, one frees the locks.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(4)
    } finally {
      spy.mockRestore()
    }
    for (const id of ['pln1', 'pln2', 'eur1']) expect((await readDoc(db, `${col(ORG, 'importLocks')}/${id}`))?.until ?? 0).toBe(0)
  })

  it('writes an operation once when two identical requests run at the same time', async () => {
    const ops = thirtyOps()
    const results = await Promise.allSettled([
      finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops }),
      finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops }),
    ])
    let created = 0
    let skipped = 0
    for (const r of results) {
      if (r.status === 'fulfilled') {
        created += r.value.created
        skipped += r.value.skipped
      } else {
        expect(r.reason).toBeInstanceOf(ImportError)
        expect((r.reason as ImportError).code).toBe('already_running')
      }
    }
    expect(created).toBe(30)
    expect(Object.keys(await txsOf(ORG))).toHaveLength(30)
    // Whichever request lost the step lock wrote nothing; a request that ran after the first one skips every operation.
    expect(skipped === 0 || skipped === 30).toBe(true)

    await seedCompany(ORG2)
    await finmapBatch(depsFor(), ORG2, UID, { importId: IMPORT, operations: ops })
    expect(await balancesOf(ORG)).toEqual(await balancesOf(ORG2))
    expect(await rollupsOf(ORG)).toEqual(await rollupsOf(ORG2))
  })

  it('refuses an import that is not a Finmap import of this company, or is not applied', async () => {
    await seedImport(ORG, 'imp-mt', 'mt940')
    await seedImport(ORG, 'imp-undone', 'finmap', 'undone')
    await seedCompany(ORG2)
    await seedImport(ORG2, 'imp-other')
    for (const importId of ['imp-mt', 'imp-undone', 'imp-other', 'imp-missing']) {
      await expect(finmapBatch(depsFor(), ORG, UID, { importId, operations: [op(0)] })).rejects.toMatchObject({ code: 'not_found' })
    }
    await expect(finmapBatch(depsFor(), ORG, UID, { importId: 'imp-missing', operations: [op(0)] })).rejects.toBeInstanceOf(ImportError)
    expect(Object.keys(await txsOf(ORG))).toHaveLength(0)
  })

  it('keeps the import link of an imported operation when it is edited', async () => {
    const ops = thirtyOps()
    await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops })
    const id = finmapTxId(keyOf(ops[0]))
    await updateTransaction(makeDeps(db), ORG, UID, id, parseTransactionPatch({ description: 'edytowane' }))
    expect(await readDoc(db, txPath(ORG, keyOf(ops[0])))).toMatchObject({ importId: IMPORT, description: 'edytowane' })
  })

  it('reads a duplicate check and marks exactly the operations that were written', async () => {
    const ops = thirtyOps().slice(0, 4)
    await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops.slice(0, 2) })
    const asCheck = (list: BatchOp[]) => list.map((o) => ({ accountId: o.accountId, toAccountId: o.toAccountId, identity: o.identity, ordinal: o.ordinal }))
    expect((await finmapCheck(depsFor(), ORG, asCheck(ops))).seen).toEqual([true, true, false, false])
    expect((await finmapCheck(depsFor(), ORG, asCheck([op(999)]))).seen).toEqual([false])
  })
})

/** Measures the batch writer on synthetic rows (FINMAP_PERF=<rows>): cold, on the emulator, one run; no time is asserted. */
const rows = Number(process.env.FINMAP_PERF ?? 0)
const perf = rows > 0 ? it : it.skip
describe('finmapBatch performance', () => {
  perf(`writes ${rows} synthetic operations in batches of 60`, async () => {
    const accounts = ['a1', 'a2', 'a3', 'a4', 'a5']
    await seedOrg(db, ORG)
    for (const a of accounts) await seedAccount(db, ORG, a, 'PLN', 0)
    await seedCategory(db, ORG, 'exp', 'expense')
    await seedImport(ORG, IMPORT)
    const ops = Array.from({ length: rows }, (_, i) => op(i, { accountId: accounts[i % accounts.length], day: addDays('2026-09-01', i % 30), identity: [`perf-${i}`] }))

    const spy = vi.spyOn(db, 'runTransaction')
    const t0 = performance.now()
    const cpu0 = process.cpuUsage()
    let created = 0
    for (let i = 0; i < ops.length; i += 60) {
      created += (await finmapBatch(depsFor(), ORG, UID, { importId: IMPORT, operations: ops.slice(i, i + 60) })).created
    }
    const cpu = process.cpuUsage(cpu0)
    const elapsed = performance.now() - t0
    const transactions = spy.mock.calls.length
    spy.mockRestore()
    // Written to stdout directly: vitest's console capture hides it in the emulator run.
    process.stdout.write(`FINMAP_PERF ${JSON.stringify({ rows, batches: Math.ceil(rows / 60), created, elapsedMs: Math.round(elapsed), cpuMs: Math.round((cpu.user + cpu.system) / 1000), runTransaction: transactions })}\n`)
    expect(created).toBe(rows)
  }, 600_000)
})
