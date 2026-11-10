import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { fullPatch, parseTransactionInput, toRawInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, retagTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, TODAY, UID, auditActions, balanceOf, clearFirestore, makeDeps, seedAccount, seedOrg, seedTag, testDb } from './helpers'
import { markDoc, planOf, seedPlan, txDoc } from './recurring-helpers'

const db = testDb()
const deps = makeDeps(db)
/** ZUS of 15 November (a Sunday) planned for Monday the 16th, an estimate. */
const PLAN = planOf('2026-11-15', { paymentDate: '2026-11-16', accrual: { mode: 'date', date: '2026-11-16' }, estimated: true })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

/** The create body the undo of a delete sends (lib/api/transaction-undo.ts), through the create route's parser. */
function restoreInput(tx: LedgerTransaction = PLAN) {
  return parseTransactionInput(
    { clientId: tx.id, type: tx.type, status: tx.status, accountId: tx.accountId, amountMinor: tx.amountMinor, paymentDate: tx.paymentDate, tags: tx.tags, fileUrls: tx.fileUrls },
    { internal: true },
  )
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedPlan(db, PLAN)
})

describe('«Позначити сплаченою» on an occurrence (S11)', () => {
  it('the operation becomes actual with its link, the occurrence is paid by it, the balance moves', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { status: 'actual', paymentDate: TODAY })
    expect(await txDoc(db, PLAN.id)).toMatchObject({ status: 'actual', paymentDate: TODAY, seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(await markDoc(db, PLAN.id)).toMatchObject({ reason: 'paid', txId: PLAN.id, seriesId: 'ser1', occurrence: '2026-11-15', estimated: true, manual: false, by: UID })
    expect(await balanceOf(db, ORG, 'mil')).toBe(380_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('its undo (the earlier state written back) makes it a plan again and lifts the mark', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { status: 'actual', paymentDate: TODAY })
    await updateTransaction(deps, ORG, UID, PLAN.id, fullPatch(toRawInput(PLAN)), { restore: true })
    const doc = await txDoc(db, PLAN.id)
    expect(doc).toMatchObject({ status: 'planned', paymentDate: '2026-11-16', estimated: true })
    expect(doc?.manual).toBeUndefined()
    expect(await markDoc(db, PLAN.id)).toBeUndefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(500_000)
  })
})

describe('a person changes a planned occurrence', () => {
  it('a new amount makes it manual and no longer an estimate; no mark moves', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { amountMinor: 130_000 })
    const doc = await txDoc(db, PLAN.id)
    expect(doc).toMatchObject({ status: 'planned', amountMinor: 130_000, manual: true, seriesId: 'ser1' })
    expect(doc?.estimated).toBeUndefined()
    expect(await markDoc(db, PLAN.id)).toBeUndefined()
  })

  it('a new comment or a new tag (the bulk path too) makes it manual, the estimate stays', async () => {
    await seedTag(db, ORG, 'q4')
    await updateTransaction(deps, ORG, UID, PLAN.id, { description: 'grudzień' })
    expect(await txDoc(db, PLAN.id)).toMatchObject({ manual: true, estimated: true })
    const dec = planOf('2026-12-15')
    await seedPlan(db, dec)
    await retagTransaction(deps, ORG, UID, dec.id, { add: ['q4'], remove: [] })
    expect(await txDoc(db, dec.id)).toMatchObject({ manual: true, tags: ['q4'] })
  })

  it('a request can never set the series fields', async () => {
    expect(await code(updateTransaction(deps, ORG, UID, PLAN.id, { seriesId: 'other' }))).toBe('invalid_input:seriesId')
  })
})

describe('deleting and bringing back an occurrence', () => {
  it('a deleted plan is marked deleted; its undo brings it back with its link and lifts the mark', async () => {
    await deleteTransaction(deps, ORG, UID, PLAN.id)
    expect(await txDoc(db, PLAN.id)).toBeUndefined()
    expect(await markDoc(db, PLAN.id)).toMatchObject({ reason: 'deleted', estimated: true, manual: false })
    const { transaction, replayed } = await createTransaction(deps, ORG, UID, restoreInput())
    expect(replayed).toBe(false)
    expect(transaction).toMatchObject({ id: PLAN.id, status: 'planned', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(await markDoc(db, PLAN.id)).toBeUndefined()
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.delete'])
  })

  it('a second restore of the same plan is a replay, not a second operation', async () => {
    await deleteTransaction(deps, ORG, UID, PLAN.id)
    await createTransaction(deps, ORG, UID, restoreInput())
    expect((await createTransaction(deps, ORG, UID, restoreInput())).replayed).toBe(true)
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.delete'])
  })

  it('a plan id without a mark, or with the paid mark of a match, cannot be created', async () => {
    const jan = planOf('2027-01-15')
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(jan)))).toBe('invalid_input:clientId')
    await db.doc(`organizations/${ORG}/recurringDone/${jan.id}`).set({
      schemaVersion: 1, seriesId: 'ser1', occurrence: '2027-01-15', reason: 'paid', txId: `bk_${'a'.repeat(32)}`, estimated: false, manual: false,
    })
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(jan)))).toBe('invalid_input:clientId')
  })

  it('deleting a paid occurrence keeps its paid mark', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { status: 'actual', paymentDate: TODAY })
    await deleteTransaction(deps, ORG, UID, PLAN.id)
    expect(await markDoc(db, PLAN.id)).toMatchObject({ reason: 'paid', txId: PLAN.id })
    expect(await balanceOf(db, ORG, 'mil')).toBe(500_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
