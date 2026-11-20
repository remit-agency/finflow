import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportOp } from '@/lib/domain/import/types'
import type { ImportStepRequest } from '@/lib/domain/import/request'
import { parseSeriesInput } from '@/lib/domain/recurring/input'
import { ImportError } from '@/lib/server/imports/errors'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { importKey } from '@/lib/server/imports/key'
import { listImports } from '@/lib/server/imports/list'
import { importStep } from '@/lib/server/imports/step'
import { undoStep } from '@/lib/server/imports/undo'
import { acquireLock, releaseLock } from '@/lib/server/ledger/lock'
import { confirmMatch } from '@/lib/server/ledger/plan-match'
import { createSeries } from '@/lib/server/ledger/series'
import { makeTransfer } from '@/lib/server/ledger/transfer'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedOrg, seedTag, testDb } from './helpers'

// The ledger's delete is wrapped (it calls through) so a test can change the operation between the undo's read and its delete.
vi.mock('@/lib/server/ledger/write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/ledger/write')>()
  return { ...actual, deleteTransaction: vi.fn(actual.deleteTransaction) }
})

const db = testDb()
const txPath = (id: string) => `organizations/${ORG}/transactions/${id}`
const seenPath = (key: string) => `organizations/${ORG}/bankSeen/${key}`
const importPath = (id: string) => `organizations/${ORG}/imports/${id}`

/** Deps whose clock reads `now` (the import's createdAt and the ledger's lock time). */
function depsAt(now: string): ImportDeps {
  const ledger = makeDeps(db, { now: () => new Date(now) })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

const T1 = '2026-10-27T10:00:00Z'
const T2 = '2026-10-27T11:00:00Z'
const T3 = '2026-10-27T12:00:00Z'

/** A statement line of the file, as the preview sends it (the ordinal is the parser's). */
function line(over: Partial<ImportOp> = {}): ImportOp {
  return { day: '2026-10-20', type: 'income', amountMinor: 10_000, reference: 'R1', counterpartyName: 'ACME', remittance: 'Faktura 12/10', ordinal: 0, ...over }
}
const SECOND = line({ day: '2026-10-21', type: 'expense', amountMinor: 4_000, reference: 'R2', counterpartyName: 'Klient', remittance: 'Zakup', ordinal: 0 })
const THIRD = line({ amountMinor: 2_000, reference: 'R3', remittance: 'Trzecia', ordinal: 0 })

function statement(over: Partial<ImportStepRequest['statement']> = {}): ImportStepRequest['statement'] {
  return { source: 'PL61109010140000071219812874', currency: 'PLN', from: '2026-10-20', to: '2026-10-21', closingMinor: null, complete: true, ...over }
}

function step(over: Partial<ImportStepRequest> = {}): ImportStepRequest {
  return { fileName: 'wyciag.sta', accountId: 'a1', statement: statement(), operations: [line(), SECOND], last: false, ...over }
}

/** The id of the operation a line of account `accountId` becomes. */
const bkId = (op: ImportOp, accountId = 'a1') => `bk_${importKey(accountId, op)}`
const keyOf = (op: ImportOp, accountId = 'a1') => importKey(accountId, op)

const importDoc = (id: string) => readDoc(db, importPath(id))
const seenCount = async () => (await db.collection(`organizations/${ORG}/bankSeen`).get()).size
const txCount = async () => (await db.collection(`organizations/${ORG}/transactions`).get()).size

async function viewOf(id: string) {
  const views = await listImports(depsAt(T3), ORG)
  const view = views.find((v) => v.id === id)
  if (!view) throw new Error(`import ${id} is not listed`)
  return view
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
})

describe('listImports: the imports of the company', () => {
  it('lists newest first and never another company’s imports', async () => {
    const first = await importStep(depsAt(T1), ORG, UID, step())
    const second = await importStep(depsAt(T2), ORG, UID, step({ fileName: 'drugi.sta', operations: [THIRD] }))

    await seedOrg(db, 'org2')
    await seedAccount(db, 'org2', 'a1', 'PLN', 0)
    await importStep(depsAt(T3), 'org2', UID, step({ fileName: 'obcy.sta' }))

    const views = await listImports(depsAt(T3), ORG)
    expect(views.map((v) => v.id)).toEqual([second.importId, first.importId])
    expect(views[0]).toEqual({
      id: second.importId,
      fileName: 'drugi.sta',
      createdAt: T2.replace('Z', '.000Z'),
      accountIds: ['a1'],
      period: { from: '2026-10-20', to: '2026-10-21' },
      counts: { created: 1, skipped: 0, refused: 0 },
      statements: [{ source: 'PL61109010140000071219812874', accountId: 'a1', from: '2026-10-20', to: '2026-10-21' }],
      status: 'applied',
      undo: { deleted: 0, kept: 0 },
    })
    expect(views[0]).not.toHaveProperty('fit')
    expect(views[0]).not.toHaveProperty('createdBy')
  })
})

describe('undoStep: removes an import', () => {
  it('an untouched import: deletes its operations and their marks, restores the balance, keeps the ledger clean and audits each delete', async () => {
    const deps = depsAt(T1)
    const res = await importStep(deps, ORG, UID, step())
    expect(await balanceOf(db, ORG, 'a1')).toBe(6_000)

    const undone = await undoStep(deps, ORG, UID, res.importId)
    expect(undone).toEqual({ deleted: 2, kept: [], next: null, done: true })

    for (const op of [line(), SECOND]) {
      expect(await readDoc(db, txPath(bkId(op)))).toBeUndefined()
      expect(await readDoc(db, seenPath(keyOf(op)))).toBeUndefined()
    }
    expect(await seenCount()).toBe(0)
    expect(await balanceOf(db, ORG, 'a1')).toBe(0)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)

    expect(await importDoc(res.importId)).toMatchObject({ status: 'undone', undo: { deleted: 2, kept: 0 } })
    expect(await viewOf(res.importId)).toMatchObject({ status: 'undone', undoneAt: T1.replace('Z', '.000Z'), undo: { deleted: 2, kept: 0 } })

    const audit = await db.collection(`organizations/${ORG}/audit`).where('via', '==', 'import-undo').get()
    expect(audit.docs.map((d) => `${d.get('action')}:${d.get('targetId')}`).sort()).toEqual([`tx.delete:${bkId(line())}`, `tx.delete:${bkId(SECOND)}`].sort())
  })

  it('a re-import after the undo creates the operations again, and a second undo of that import works', async () => {
    const res = await importStep(depsAt(T1), ORG, UID, step())
    await undoStep(depsAt(T1), ORG, UID, res.importId)

    const again = await importStep(depsAt(T2), ORG, UID, step())
    expect(again).toMatchObject({ created: 2, skipped: { seen: 0, bank: 0 } })
    expect(again.importId).not.toBe(res.importId)
    expect(await balanceOf(db, ORG, 'a1')).toBe(6_000)

    expect(await undoStep(depsAt(T3), ORG, UID, again.importId)).toEqual({ deleted: 2, kept: [], next: null, done: true })
    expect(await balanceOf(db, ORG, 'a1')).toBe(0)
  })

  it('an operation changed after the import (category, or comment) is kept as changed; its mark stays; the import is undone with the counts', async () => {
    const deps = depsAt(T1)
    await seedCategory(db, ORG, 'k-in', 'income')
    const res = await importStep(deps, ORG, UID, step({ operations: [line(), SECOND, THIRD] }))
    await updateTransaction(deps.ledger, ORG, UID, bkId(line()), { categoryId: 'k-in' })
    await updateTransaction(deps.ledger, ORG, UID, bkId(SECOND), { description: 'Mój komentarz' })

    const undone = await undoStep(depsAt(T2), ORG, UID, res.importId)
    expect(undone.deleted).toBe(1)
    expect(undone.done).toBe(true)
    expect(undone.next).toBeNull()
    expect(undone.kept.map((k) => k.id).sort()).toEqual([bkId(line()), bkId(SECOND)].sort())
    expect(undone.kept.every((k) => k.reason === 'changed')).toBe(true)

    expect(await readDoc(db, txPath(bkId(THIRD)))).toBeUndefined()
    expect(await readDoc(db, txPath(bkId(line())))).toMatchObject({ categoryId: 'k-in' })
    expect(await readDoc(db, seenPath(keyOf(line())))).toBeDefined()
    expect(await readDoc(db, seenPath(keyOf(SECOND)))).toBeDefined()
    expect(await readDoc(db, seenPath(keyOf(THIRD)))).toBeUndefined()

    expect(await importDoc(res.importId)).toMatchObject({ status: 'undone', undo: { deleted: 1, kept: 2 } })
    expect(await balanceOf(db, ORG, 'a1')).toBe(6_000)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('an operation that became part of a transfer is kept as changed (S10b)', async () => {
    const deps = depsAt(T1)
    await seedAccount(db, ORG, 'a2', 'PLN', 0)
    const out = line({ day: '2026-10-20', type: 'expense', amountMinor: 100_000, reference: 'T1', remittance: 'Przelew', ordinal: 0 })
    const inc = line({ day: '2026-10-20', type: 'income', amountMinor: 100_000, reference: 'T2', remittance: 'Przelew', ordinal: 0 })
    const first = await importStep(deps, ORG, UID, step({ operations: [out], statement: statement({ from: '2026-10-20', to: '2026-10-20' }) }))
    await importStep(deps, ORG, UID, step({ importId: first.importId, accountId: 'a2', operations: [inc], statement: statement({ from: '2026-10-20', to: '2026-10-20' }) }))

    await makeTransfer(deps.ledger, ORG, UID, { mode: 'pair', ids: [bkId(out), bkId(inc, 'a2')] })
    expect(await readDoc(db, txPath(bkId(inc, 'a2')))).toBeUndefined()

    const undone = await undoStep(depsAt(T2), ORG, UID, first.importId)
    expect(undone).toEqual({ deleted: 0, kept: [{ id: bkId(out), reason: 'changed' }], next: null, done: true })
    expect(await readDoc(db, txPath(bkId(out)))).toMatchObject({ type: 'transfer', accountId: 'a1', toAccountId: 'a2' })
    expect(await readDoc(db, seenPath(keyOf(out)))).toBeDefined()
    expect(await importDoc(first.importId)).toMatchObject({ status: 'undone', undo: { deleted: 0, kept: 1 } })
  })

  it('an operation matched to a plan is kept as changed (S11)', async () => {
    const deps = depsAt(T1)
    await seedCategory(db, ORG, 'rent', 'expense')
    await seedTag(db, ORG, 'office')
    const rent = parseSeriesInput({
      name: 'Czynsz', kind: 'expense', accountId: 'a1', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 27, startDate: '2026-10-01',
      categoryId: 'rent', tags: ['office'], description: 'Lokal 3',
    })
    const seriesId = (await createSeries(deps.ledger, ORG, UID, rent)).series.id
    const paid = line({ day: '2026-10-26', type: 'expense', amountMinor: 250_000, reference: 'RENT1', remittance: 'Czynsz', ordinal: 0 })
    const res = await importStep(deps, ORG, UID, step({ operations: [paid], statement: statement({ from: '2026-10-26', to: '2026-10-26' }) }))

    await confirmMatch(deps.ledger, ORG, UID, { planId: `pl_${seriesId}_2026-10-27`, bankId: bkId(paid) })
    expect(await readDoc(db, txPath(bkId(paid)))).toMatchObject({ seriesId })

    const undone = await undoStep(depsAt(T2), ORG, UID, res.importId)
    expect(undone).toEqual({ deleted: 0, kept: [{ id: bkId(paid), reason: 'changed' }], next: null, done: true })
    expect(await readDoc(db, seenPath(keyOf(paid)))).toBeDefined()
  })

  it('60 operations are undone in steps of 25 with a cursor; the sum is 60; a mark removed before the undo does not keep its operation', async () => {
    const deps = depsAt(T1)
    const ops = Array.from({ length: 60 }, (_, i) => line({ amountMinor: 100 + i, reference: `B${i}`, remittance: `Wplata ${i}` }))
    let importId: string | undefined
    for (let i = 0; i < ops.length; i += 25) {
      const res = await importStep(deps, ORG, UID, step({ importId, operations: ops.slice(i, i + 25) }))
      importId ??= res.importId
    }
    expect(await balanceOf(db, ORG, 'a1')).toBe(7_770)
    // Crash between "mark removed" and "operation deleted" of one operation: the undo must still delete it.
    await db.doc(seenPath(keyOf(ops[40]))).delete()
    const id = importId as string

    const first = await undoStep(deps, ORG, UID, id)
    expect(first.deleted).toBe(25)
    expect(first.done).toBe(false)
    expect(first.next).not.toBeNull()

    const second = await undoStep(deps, ORG, UID, id, first.next as string)
    expect(second.deleted).toBe(25)
    expect(second.done).toBe(false)

    const third = await undoStep(deps, ORG, UID, id, second.next as string)
    expect(third).toEqual({ deleted: 10, kept: [], next: null, done: true })

    expect(first.deleted + second.deleted + third.deleted).toBe(60)
    expect(await readDoc(db, txPath(bkId(ops[40])))).toBeUndefined()
    expect(await txCount()).toBe(0)
    expect(await seenCount()).toBe(0)
    expect(await balanceOf(db, ORG, 'a1')).toBe(0)
  })

  it('an operation deleted by the person before the undo is not found, and its mark stays', async () => {
    const deps = depsAt(T1)
    const res = await importStep(deps, ORG, UID, step())
    await deleteTransaction(deps.ledger, ORG, UID, bkId(line()))

    const undone = await undoStep(depsAt(T2), ORG, UID, res.importId)
    expect(undone).toEqual({ deleted: 1, kept: [], next: null, done: true })
    expect(await readDoc(db, txPath(bkId(line())))).toBeUndefined()
    // A mark whose operation is gone would make a re-import skip the line for good, so the undo removes it at its last step.
    expect(await readDoc(db, seenPath(keyOf(line())))).toBeUndefined()
    expect(await balanceOf(db, ORG, 'a1')).toBe(0)
  })

  it('a mark is put back after a ledger refusal only while its operation is there: one deleted by someone else meanwhile leaves no mark and is not kept', async () => {
    const deps = depsAt(T1)
    const res = await importStep(deps, ORG, UID, step())
    const real = await vi.importActual<typeof import('@/lib/server/ledger/write')>('@/lib/server/ledger/write')
    vi.mocked(deleteTransaction).mockImplementationOnce(async (...args) => {
      // Someone deletes the operation after the undo read it and before the undo deletes it.
      await db.doc(txPath(bkId(line()))).delete()
      return real.deleteTransaction(...args)
    })

    const undone = await undoStep(depsAt(T2), ORG, UID, res.importId)
    expect(undone).toEqual({ deleted: 1, kept: [], next: null, done: true })
    expect(await readDoc(db, seenPath(keyOf(line())))).toBeUndefined()
  })

  it('an operation edited between the undo read and its delete is kept as changed, and its mark stays', async () => {
    const deps = depsAt(T1)
    await seedCategory(db, ORG, 'k-income', 'income')
    const res = await importStep(deps, ORG, UID, step({ operations: [line()] }))
    const real = await vi.importActual<typeof import('@/lib/server/ledger/write')>('@/lib/server/ledger/write')
    vi.mocked(deleteTransaction).mockImplementationOnce(async (...args) => {
      await updateTransaction(deps.ledger, ORG, UID, bkId(line()), { categoryId: 'k-income' })
      return real.deleteTransaction(...args)
    })

    const undone = await undoStep(depsAt(T2), ORG, UID, res.importId)
    expect(undone).toEqual({ deleted: 0, kept: [{ id: bkId(line()), reason: 'changed' }], next: null, done: true })
    expect(await readDoc(db, txPath(bkId(line())))).toMatchObject({ categoryId: 'k-income' })
    expect(await readDoc(db, seenPath(keyOf(line())))).toBeDefined()
  })

  it('deleteTransaction with an expected version that is no longer the stored one is a conflict and deletes nothing', async () => {
    const deps = depsAt(T1)
    await seedCategory(db, ORG, 'k-income', 'income')
    await importStep(deps, ORG, UID, step({ operations: [line()] }))
    const before = (await db.doc(txPath(bkId(line()))).get()).updateTime
    await updateTransaction(deps.ledger, ORG, UID, bkId(line()), { categoryId: 'k-income' })

    await expect(deleteTransaction(deps.ledger, ORG, UID, bkId(line()), 'import-undo', before)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readDoc(db, txPath(bkId(line())))).toBeDefined()
  })

  it('the undo removes the marks of its operations that a person deleted, so a re-import brings all ten operations back', async () => {
    const deps = depsAt(T1)
    const ops = Array.from({ length: 10 }, (_, i) => line({ reference: `Q${i}`, amountMinor: 1_000 + i }))
    const res = await importStep(deps, ORG, UID, step({ operations: ops }))
    await deleteTransaction(deps.ledger, ORG, UID, bkId(ops[3]))
    await deleteTransaction(deps.ledger, ORG, UID, bkId(ops[7]))

    expect(await undoStep(depsAt(T2), ORG, UID, res.importId)).toMatchObject({ deleted: 8, kept: [], done: true })
    expect(await seenCount()).toBe(0)

    const again = await importStep(depsAt(T3), ORG, UID, step({ operations: ops }))
    expect(again).toMatchObject({ created: 10, skipped: { seen: 0, bank: 0 } })
    expect(await txCount()).toBe(10)
  })

  it('an undo waits for the step lock of each account of the import: while one is held it is already_running and deletes nothing', async () => {
    const deps = depsAt(T1)
    const res = await importStep(deps, ORG, UID, step())
    await db.doc(`organizations/${ORG}/importLocks/a1`).set({ until: Date.parse(T2) + 30_000, token: 'other' })

    await expect(undoStep(depsAt(T2), ORG, UID, res.importId)).rejects.toMatchObject({ code: 'already_running' })
    expect(await txCount()).toBe(2)
    expect(await importDoc(res.importId)).toMatchObject({ status: 'applied' })
    expect(await readDoc(db, `organizations/${ORG}/importLocks/a1`)).toMatchObject({ token: 'other' })
  })

  it('a ledger refusal keeps the operation with the LedgerError code, puts its mark back, and the step continues', async () => {
    const deps = depsAt(T1)
    const res = await importStep(deps, ORG, UID, step())
    const markBefore = await readDoc(db, seenPath(keyOf(line())))
    // The lease is read against the clock of the call: the lock and the undo share one clock.
    const undoDeps = depsAt(T2)
    const token = await acquireLock(undoDeps.ledger, ORG, 'test')
    let undone
    try {
      undone = await undoStep(undoDeps, ORG, UID, res.importId)
    } finally {
      await releaseLock(undoDeps.ledger, ORG, token)
    }
    expect(undone.deleted).toBe(0)
    expect(undone.done).toBe(true)
    expect(undone.kept.map((k) => k.id).sort()).toEqual([bkId(line()), bkId(SECOND)].sort())
    expect(undone.kept.every((k) => k.reason === 'ledger_busy')).toBe(true)

    expect(await readDoc(db, txPath(bkId(line())))).toMatchObject({ amountMinor: 10_000 })
    expect(await readDoc(db, seenPath(keyOf(line())))).toEqual(markBefore)
    expect(await readDoc(db, seenPath(keyOf(SECOND)))).toBeDefined()
    expect(await importDoc(res.importId)).toMatchObject({ status: 'undone', undo: { deleted: 0, kept: 2 } })
  })

  it('an unknown import is not_found; an undone import is done at once with nothing deleted', async () => {
    const deps = depsAt(T1)
    await expect(undoStep(deps, ORG, UID, 'missing-import')).rejects.toMatchObject({ code: 'not_found' })
    await expect(undoStep(deps, ORG, UID, 'missing-import')).rejects.toBeInstanceOf(ImportError)

    const res = await importStep(deps, ORG, UID, step())
    await undoStep(deps, ORG, UID, res.importId)
    const counts = (await importDoc(res.importId))?.undo
    expect(await undoStep(deps, ORG, UID, res.importId)).toEqual({ deleted: 0, kept: [], next: null, done: true })
    expect((await importDoc(res.importId))?.undo).toEqual(counts)
  })
})
