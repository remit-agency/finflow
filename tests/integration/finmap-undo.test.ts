import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import type { BatchOp } from '@/lib/domain/import/finmap/request'
import { addDays } from '@/lib/domain/ledger/days'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { flatten } from '@/lib/domain/ledger/rollups'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { ImportError } from '@/lib/server/imports/errors'
import { finmapBatch } from '@/lib/server/imports/finmap/batch'
import { finmapKey, finmapTxId } from '@/lib/server/imports/finmap/key'
import { undoFinmapStep } from '@/lib/server/imports/finmap/undo'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, seedTag, testDb } from './helpers'

const db = testDb()
const NOW = new Date('2026-10-27T10:00:00Z')
const IMPORT = 'imp1'
const ACCOUNTS = ['pln1', 'pln2', 'pln3']

const col = (name: string) => `organizations/${ORG}/${name}`
const txPath = (id: string) => `${col('transactions')}/${id}`
const markPath = (key: string) => `${col('bankSeen')}/${key}`
const importPath = (id: string) => `${col('imports')}/${id}`
const keyOf = (o: BatchOp): string => finmapKey(o.accountId, o.toAccountId, o.identity, o.ordinal)

function depsFor(): ImportDeps {
  const ledger = makeDeps(db, { now: () => NOW })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

function ledgerDeps() {
  return makeDeps(db, { now: () => NOW })
}

/** A batch operation of the test company (PLN accounts only: no rate evidence needed). */
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

/** Operations spread over the three accounts, expenses and income, on the days `dayOf` gives. */
function manyOps(count: number, dayOf: (n: number) => string = (n) => addDays('2026-01-01', n % 120), tag = 'row'): BatchOp[] {
  return Array.from({ length: count }, (_, n) => op(n, {
    kind: n % 4 === 0 ? 'income' : 'expense',
    categoryId: n % 4 === 0 ? 'inc' : 'exp',
    accountId: ACCOUNTS[n % 3],
    day: dayOf(n),
    amountMinor: 100 + n,
    identity: [`${tag}-${n}`],
  }))
}

/** An import document as the Finmap setup writes it (applied, nothing counted yet). */
async function seedImport(id: string, kind: 'finmap' | 'mt940' = 'finmap'): Promise<void> {
  await db.doc(importPath(id)).set({
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
    status: 'applied',
    undo: { deleted: 0, kept: 0 },
  })
}

/** A company with three PLN accounts (the first one opened with 1000), categories, a counterparty, a tag and the import. */
async function seedCompany(): Promise<void> {
  await seedOrg(db, ORG)
  await seedAccount(db, ORG, 'pln1', 'PLN', 1000)
  await seedAccount(db, ORG, 'pln2', 'PLN', 0)
  await seedAccount(db, ORG, 'pln3', 'PLN', 0)
  await seedCategory(db, ORG, 'inc', 'income')
  await seedCategory(db, ORG, 'exp', 'expense')
  await seedCategory(db, ORG, 'inc2', 'income')
  await seedCounterparty(db, ORG, 'cp1')
  await seedTag(db, ORG, 't-plain')
  await seedImport(IMPORT)
}

/** Imports the operations in requests of 60, into `importId`. Returns the number created. */
async function importAll(importId: string, ops: BatchOp[]): Promise<number> {
  let created = 0
  for (let i = 0; i < ops.length; i += 60) {
    created += (await finmapBatch(depsFor(), ORG, UID, { importId, operations: ops.slice(i, i + 60) })).created
  }
  return created
}

/** Runs undo steps until the import is done; returns every step's result. */
async function undoAll(importId: string = IMPORT) {
  const steps = []
  let cursor: string | undefined
  for (let i = 0; i < 100; i++) {
    const r = await undoFinmapStep(depsFor(), ORG, UID, importId, cursor)
    steps.push(r)
    if (r.done) return steps
    cursor = r.next ?? undefined
  }
  throw new Error('undo did not finish')
}

async function txIds(): Promise<string[]> {
  return (await db.collection(col('transactions')).get()).docs.map((d) => d.id).sort()
}

async function markKeys(): Promise<string[]> {
  return (await db.collection(col('bankSeen')).get()).docs.map((d) => d.id).sort()
}

async function balancesOf(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of ACCOUNTS) out[id] = (await readDoc(db, `${col('accounts')}/${id}`))?.balanceMinor as number
  return out
}

/** The rollup fields that are not zero, by document: an undone import leaves zeroed documents behind, which are not state. */
async function liveRollups(): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  for (const d of (await db.collection(col('rollups')).get()).docs) {
    const live = Object.fromEntries(Object.entries(flatten(d.data())).filter(([, v]) => v !== 0))
    if (Object.keys(live).length > 0) out[d.id] = live
  }
  return out
}

/** The audit entries of the Finmap undo (`import.batch` with `via: 'import-undo'`). */
async function undoAudits(): Promise<Array<{ after: { importId: string; deleted: number } }>> {
  const snap = await db.collection(col('audit')).where('action', '==', 'import.batch').get()
  return snap.docs.map((d) => d.data()).filter((a) => a.via === 'import-undo') as Array<{ after: { importId: string; deleted: number } }>
}

const deletedOf = (steps: Array<{ deleted: number }>): number => steps.reduce((n, s) => n + s.deleted, 0)

beforeEach(async () => {
  await clearFirestore()
  await seedCompany()
})

describe('undoFinmapStep', () => {
  it('undoes a 150-operation import: operations, marks, balances and rollups go back, the import is undone and audited', async () => {
    const before = await balancesOf()
    expect(await liveRollups()).toEqual({})
    const ops = manyOps(150)
    expect(await importAll(IMPORT, ops)).toBe(150)
    expect(await txIds()).toHaveLength(150)
    expect(await liveRollups()).not.toEqual({})

    const steps = await undoAll()
    expect(deletedOf(steps)).toBe(150)
    expect(steps.flatMap((s) => s.kept)).toEqual([])
    expect(await txIds()).toEqual([])
    expect(await markKeys()).toEqual([])
    expect(await balancesOf()).toEqual(before)
    expect(await liveRollups()).toEqual({})
    expect(await readDoc(db, importPath(IMPORT))).toMatchObject({ status: 'undone', undo: { deleted: 150, kept: 0 } })
    expect(await verifyLedger(ledgerDeps(), ORG)).toMatchObject({ ok: true, transactions: 0, balanceDiffs: [], rollupDiffs: [] })

    const audits = await undoAudits()
    expect(audits.length).toBeGreaterThanOrEqual(3)
    expect(audits.reduce((n, a) => n + a.after.deleted, 0)).toBe(150)
    expect(audits.every((a) => a.after.importId === IMPORT)).toBe(true)
  })

  it('keeps what a person did after the import: an edited operation and one turned into a transfer (changed, with their marks), and a transfer made by hand', async () => {
    const ops = manyOps(30)
    await importAll(IMPORT, ops)
    const edited = finmapTxId(keyOf(ops[0]))
    await updateTransaction(ledgerDeps(), ORG, UID, edited, parseTransactionPatch({ categoryId: 'inc2' }))
    const asTransfer = finmapTxId(keyOf(ops[1]))
    await updateTransaction(ledgerDeps(), ORG, UID, asTransfer, parseTransactionPatch({ type: 'transfer', toAccountId: 'pln3', categoryId: null }))
    const handId = 'hand-transfer-1'
    await createTransaction(ledgerDeps(), ORG, UID, parseTransactionInput({ clientId: handId, type: 'transfer', accountId: 'pln1', toAccountId: 'pln3', amountMinor: 500, paymentDate: '2026-02-01' }))

    const steps = await undoAll()
    expect(deletedOf(steps)).toBe(28)
    expect(steps.flatMap((s) => s.kept).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [{ id: edited, reason: 'changed' }, { id: asTransfer, reason: 'changed' }].sort((a, b) => a.id.localeCompare(b.id)),
    )
    expect(await readDoc(db, txPath(edited))).toMatchObject({ categoryId: 'inc2', importId: IMPORT })
    expect(await readDoc(db, markPath(keyOf(ops[0])))).toBeDefined()
    expect(await readDoc(db, txPath(asTransfer))).toMatchObject({ type: 'transfer', toAccountId: 'pln3' })
    expect(await readDoc(db, markPath(keyOf(ops[1])))).toBeDefined()
    expect(await readDoc(db, txPath(handId))).toMatchObject({ type: 'transfer' })
    expect(await readDoc(db, importPath(IMPORT))).toMatchObject({ status: 'undone', undo: { deleted: 28, kept: 2 } })
    expect(await verifyLedger(ledgerDeps(), ORG)).toMatchObject({ ok: true, balanceDiffs: [], rollupDiffs: [] })
  })

  it('pages by 60 with a cursor, and a step that repeats after a crash (marks of the next page gone) finishes the same way', async () => {
    const ops = manyOps(100)
    await importAll(IMPORT, ops)
    const first = await undoFinmapStep(depsFor(), ORG, UID, IMPORT)
    expect(first).toMatchObject({ deleted: 60, kept: [], done: false })
    expect(first.next).toEqual(expect.any(String))

    // A crash after the first step: the marks of five operations still to come are gone, their operations are not.
    const next = first.next as string
    const pending = (await txIds()).filter((id) => id > next).slice(0, 5)
    expect(pending).toHaveLength(5)
    for (const id of pending) await db.doc(markPath(id.slice('fm_'.length))).delete()

    const second = await undoFinmapStep(depsFor(), ORG, UID, IMPORT, next)
    expect(second).toEqual({ deleted: 40, kept: [], next: null, done: true })
    expect(await txIds()).toEqual([])
    expect(await markKeys()).toEqual([])
    // Repeating a finished step deletes nothing.
    expect(await undoFinmapStep(depsFor(), ORG, UID, IMPORT, next)).toEqual({ deleted: 0, kept: [], next: null, done: true })
    expect(await verifyLedger(ledgerDeps(), ORG)).toMatchObject({ ok: true, transactions: 0 })
  })

  it('commits a step in several transactions when its footprint exceeds the budget, and in one by default', async () => {
    const days = (n: number) => addDays('2026-01-01', n)
    // 60 operations on 60 distinct days over three accounts: the default budget (450 writes) holds them in one group.
    await importAll(IMPORT, manyOps(60, days, 'a'))
    const spyDefault = vi.spyOn(db, 'runTransaction')
    const first = await undoFinmapStep(depsFor(), ORG, UID, IMPORT)
    const defaultCalls = spyDefault.mock.calls.length
    spyDefault.mockRestore()
    expect(first).toMatchObject({ deleted: 60, done: false })
    // The locks of the three accounts (taken in one transaction, freed in one) plus one transaction for the group.
    expect(defaultCalls).toBe(2 + 1)
    await undoAll()

    // The same shape on a second import, with a budget small enough to split it.
    await seedImport('imp-b')
    await importAll('imp-b', manyOps(60, days, 'b'))
    const spy = vi.spyOn(db, 'runTransaction')
    const split = await undoFinmapStep(depsFor(), ORG, UID, 'imp-b', undefined, { budget: 60 })
    const splitCalls = spy.mock.calls.length
    spy.mockRestore()
    expect(split).toMatchObject({ deleted: 60, kept: [], done: false })
    expect(splitCalls).toBeGreaterThan(2 + 1)
    await undoAll('imp-b')
    expect(await txIds()).toEqual([])
    expect(await verifyLedger(ledgerDeps(), ORG)).toMatchObject({ ok: true, transactions: 0, balanceDiffs: [], rollupDiffs: [] })
    const audits = (await undoAudits()).filter((a) => a.after.importId === 'imp-b')
    expect(audits.length).toBeGreaterThan(1)
    expect(audits.reduce((n, a) => n + a.after.deleted, 0)).toBe(60)
  })

  it('removes the mark of an operation a person deleted before the undo, so a re-import brings it back', async () => {
    const ops = manyOps(30)
    await importAll(IMPORT, ops)
    const gone = finmapTxId(keyOf(ops[5]))
    await deleteTransaction(ledgerDeps(), ORG, UID, gone)
    const steps = await undoAll()
    expect(deletedOf(steps)).toBe(29)
    expect(await readDoc(db, markPath(keyOf(ops[5])))).toBeUndefined()
    expect(await markKeys()).toEqual([])

    await seedImport('imp2')
    expect(await finmapBatch(depsFor(), ORG, UID, { importId: 'imp2', operations: ops })).toEqual({ created: 30, skipped: 0, refused: [] })
    expect(await readDoc(db, txPath(gone))).toMatchObject({ importId: 'imp2' })
  })

  it('throws already_running when one of the import accounts is locked, frees the locks it took before, and changes nothing', async () => {
    const ops = manyOps(10)
    await importAll(IMPORT, ops)
    // The locks are taken in account order (pln1, pln2, pln3): pln3 is held by another step.
    await db.doc(`${col('importLocks')}/pln3`).set({ until: NOW.getTime() + 60_000, token: 'another-step' })
    await expect(undoFinmapStep(depsFor(), ORG, UID, IMPORT)).rejects.toMatchObject({ code: 'already_running' })
    expect(await readDoc(db, `${col('importLocks')}/pln1`)).toMatchObject({ until: 0, token: null })
    expect(await readDoc(db, `${col('importLocks')}/pln2`)).toMatchObject({ until: 0, token: null })
    expect(await txIds()).toHaveLength(10)
    expect(await readDoc(db, importPath(IMPORT))).toMatchObject({ status: 'applied' })
  })

  it('leaves the accounts, categories and tags of the company in place', async () => {
    await importAll(IMPORT, manyOps(10))
    await undoAll()
    expect(await readDoc(db, `${col('accounts')}/pln1`)).toBeDefined()
    expect(await readDoc(db, `${col('accounts')}/pln3`)).toBeDefined()
    expect(await readDoc(db, `${col('categories')}/inc`)).toBeDefined()
    expect(await readDoc(db, `${col('categories')}/exp`)).toBeDefined()
    expect(await readDoc(db, `${col('tags')}/t-plain`)).toBeDefined()
  })

  it('answers done at once for an undone import, and refuses an import that is not a Finmap import of this company', async () => {
    await importAll(IMPORT, manyOps(5))
    await undoAll()
    expect(await undoFinmapStep(depsFor(), ORG, UID, IMPORT)).toEqual({ deleted: 0, kept: [], next: null, done: true })
    await expect(undoFinmapStep(depsFor(), ORG, UID, 'missing')).rejects.toBeInstanceOf(ImportError)
  })
})

/** The body the undo of a delete sends for an imported operation: its draft under its own id (as the browser sends it). */
function restoreBody(o: BatchOp): Record<string, unknown> {
  return {
    clientId: finmapTxId(keyOf(o)),
    type: o.kind,
    status: o.status,
    accountId: o.accountId,
    amountMinor: o.amountMinor,
    paymentDate: o.day,
    tags: o.tagIds,
    ...(o.categoryId === null ? {} : { categoryId: o.categoryId }),
  }
}

/** The Finmap mark of an operation, as the batch writes it, with some fields replaced. */
async function seedMark(key: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.doc(markPath(key)).set({ txId: finmapTxId(key), at: NOW.toISOString(), importId: IMPORT, kind: 'finmap', ...over })
}

const restore = (body: Record<string, unknown>) => createTransaction(ledgerDeps(), ORG, UID, parseTransactionInput(body, { internal: true }))

describe('restoring a deleted Finmap operation (the undo of a delete)', () => {
  it('brings an imported operation back under its id with its import link, the same balances and rollups, and no second mark', async () => {
    const ops = manyOps(10)
    await importAll(IMPORT, ops)
    const o = ops[3]
    const id = finmapTxId(keyOf(o))
    const balances = await balancesOf()
    const rollups = await liveRollups()
    const marks = await markKeys()

    await deleteTransaction(ledgerDeps(), ORG, UID, id)
    expect(await readDoc(db, txPath(id))).toBeUndefined()
    expect((await restore(restoreBody(o))).transaction.id).toBe(id)

    expect(await readDoc(db, txPath(id))).toMatchObject({ importId: IMPORT, accountId: o.accountId, amountMinor: o.amountMinor, paymentDate: o.day })
    expect(await balancesOf()).toEqual(balances)
    expect(await liveRollups()).toEqual(rollups)
    expect(await markKeys()).toEqual(marks)
    expect(await verifyLedger(ledgerDeps(), ORG)).toMatchObject({ ok: true, balanceDiffs: [], rollupDiffs: [] })
  })

  it('refuses a Finmap id without its mark: one the person invents, and one whose mark the undo already removed', async () => {
    const ops = manyOps(5)
    await importAll(IMPORT, ops)
    const invented = { ...restoreBody(ops[0]), clientId: `fm_${'a'.repeat(32)}` }
    await expect(restore(invented)).rejects.toMatchObject({ code: 'invalid_input', field: 'clientId' })

    const o = ops[1]
    await deleteTransaction(ledgerDeps(), ORG, UID, finmapTxId(keyOf(o)))
    await db.doc(markPath(keyOf(o))).delete()
    await expect(restore(restoreBody(o))).rejects.toMatchObject({ code: 'invalid_input', field: 'clientId' })
    expect(await txIds()).toHaveLength(4)
  })

  it('refuses a mark that is not the operation\'s own Finmap mark: another import, a missing import, another kind, another operation', async () => {
    const ops = manyOps(5)
    await importAll(IMPORT, ops)
    const o = ops[2]
    const key = keyOf(o)
    await deleteTransaction(ledgerDeps(), ORG, UID, finmapTxId(key))
    await seedImport('mt940-imp', 'mt940')
    const cases: Record<string, Record<string, unknown>> = {
      'an MT940 import': { importId: 'mt940-imp' },
      'an import that does not exist': { importId: 'gone-imp' },
      'another kind of mark': { kind: 'mt940' },
      'a mark of another operation': { txId: `fm_${'b'.repeat(32)}` },
    }
    for (const [name, over] of Object.entries(cases)) {
      await seedMark(key, over)
      await expect(restore(restoreBody(o)), name).rejects.toMatchObject({ code: 'invalid_input', field: 'clientId' })
    }
    expect(await txIds()).toHaveLength(4)
  })

  it('refuses a restore whose type, account, amount or payment date is not the one its mark recorded', async () => {
    const ops = manyOps(5)
    await importAll(IMPORT, ops)
    const o = ops[1]
    const id = finmapTxId(keyOf(o))
    await deleteTransaction(ledgerDeps(), ORG, UID, id)
    const changed: Array<[string, Record<string, unknown>]> = [
      ['amount', { ...restoreBody(o), amountMinor: o.amountMinor + 1 }],
      ['payment date', { ...restoreBody(o), paymentDate: '2020-01-01' }],
      ['account', { ...restoreBody(o), accountId: o.accountId === 'pln1' ? 'pln2' : 'pln1' }],
      // Without a category: the type change must not be refused for the category's type first.
      ['type', { ...restoreBody(o), type: o.kind === 'expense' ? 'income' : 'expense', categoryId: undefined }],
    ]
    for (const [field, body] of changed) {
      await expect(restore(body), field).rejects.toMatchObject({ code: 'invalid_input', field: 'clientId' })
    }
    expect(await readDoc(db, txPath(id))).toBeUndefined()
    // The operation as the batch wrote it still comes back.
    expect((await restore(restoreBody(o))).transaction.id).toBe(id)
  })

  it('the import undo afterwards deletes the restored operation, found by its import id', async () => {
    const ops = manyOps(30)
    await importAll(IMPORT, ops)
    const o = ops[3]
    await deleteTransaction(ledgerDeps(), ORG, UID, finmapTxId(keyOf(o)))
    await restore(restoreBody(o))

    const steps = await undoAll()
    expect(deletedOf(steps)).toBe(30)
    expect(steps.flatMap((s) => s.kept)).toEqual([])
    expect(await txIds()).toEqual([])
    expect(await markKeys()).toEqual([])
    expect(await verifyLedger(ledgerDeps(), ORG)).toMatchObject({ ok: true, transactions: 0, balanceDiffs: [], rollupDiffs: [] })
  })
})

// Measures the Finmap undo on synthetic rows (FINMAP_PERF=<rows>): cold, on the emulator, one run; no time is asserted.
const rows = Number(process.env.FINMAP_PERF ?? 0)
const perf = rows > 0 ? it : it.skip
describe('undoFinmapStep performance', () => {
  perf(`undoes ${rows} synthetic operations in steps of 60`, async () => {
    await importAll(IMPORT, manyOps(rows))
    const spy = vi.spyOn(db, 'runTransaction')
    const t0 = performance.now()
    const cpu0 = process.cpuUsage()
    let deleted = 0
    let steps = 0
    let cursor: string | undefined
    for (;;) {
      const r = await undoFinmapStep(depsFor(), ORG, UID, IMPORT, cursor)
      steps++
      deleted += r.deleted
      if (r.done) break
      cursor = r.next ?? undefined
    }
    const cpu = process.cpuUsage(cpu0)
    const elapsed = performance.now() - t0
    const transactions = spy.mock.calls.length
    spy.mockRestore()
    // Written to stdout directly: vitest's console capture hides it in the emulator run.
    process.stdout.write(`FINMAP_UNDO_PERF ${JSON.stringify({ rows, steps, deleted, elapsedMs: Math.round(elapsed), cpuMs: Math.round((cpu.user + cpu.system) / 1000), runTransaction: transactions })}\n`)
    expect(deleted).toBe(rows)
  }, 600_000)
})
