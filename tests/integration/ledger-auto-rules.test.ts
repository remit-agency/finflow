import { beforeEach, describe, expect, it } from 'vitest'
import type { Timestamp } from 'firebase-admin/firestore'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)
const RULE = { id: 'r1', name: 'Paliwo' }
const txDoc = (id: string) => readDoc(db, `organizations/${ORG}/transactions/${id}`)
const input = (over: Record<string, unknown> = {}) =>
  parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 5_000, paymentDate: '2026-10-20', ...over })

async function auditOf(txId: string, action: string): Promise<Record<string, unknown>[]> {
  const snap = await db.collection(`organizations/${ORG}/audit`).where('targetId', '==', txId).where('action', '==', action).get()
  return snap.docs.map((d) => d.data())
}

async function versionOf(id: string): Promise<Timestamp> {
  const snap = await db.doc(`organizations/${ORG}/transactions/${id}`).get()
  if (!snap.updateTime) throw new Error('no update time')
  return snap.updateTime
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 100_000)
  await seedCategory(db, ORG, 'k-fuel', 'expense')
  await seedCategory(db, ORG, 'k-other', 'expense')
  await seedCounterparty(db, ORG, 'cp1')
})

describe('autoRules on create', () => {
  it('a create with autoRules stores them and marks its audit entry via rule', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ categoryId: 'k-fuel' }), undefined, { autoRules: [RULE] })
    expect(transaction.autoRules).toEqual([RULE])
    expect(await txDoc(transaction.id)).toMatchObject({ categoryId: 'k-fuel', autoRules: [RULE] })
    const [entry] = await auditOf(transaction.id, 'tx.create')
    expect(entry).toMatchObject({ via: 'rule', after: { autoRules: [RULE] } })
  })

  it('an ordinary create has neither', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ categoryId: 'k-fuel' }))
    expect((await txDoc(transaction.id))?.autoRules).toBeUndefined()
    const [entry] = await auditOf(transaction.id, 'tx.create')
    expect(entry).not.toHaveProperty('via')
  })
})

describe('autoRules on update', () => {
  async function ruled(): Promise<string> {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ categoryId: 'k-fuel', description: 'ORLEN' }), undefined, { autoRules: [RULE] })
    return transaction.id
  }

  it('a person changing the category removes the trace, and the audit entry is not marked', async () => {
    const id = await ruled()
    await updateTransaction(deps, ORG, UID, id, parseTransactionPatch({ categoryId: 'k-other' }))
    const doc = await txDoc(id)
    expect(doc?.categoryId).toBe('k-other')
    expect(doc?.autoRules).toBeUndefined()
    const [entry] = await auditOf(id, 'tx.update')
    expect(entry).not.toHaveProperty('via')
  })

  it('a person setting the counterparty removes it too', async () => {
    const id = await ruled()
    await updateTransaction(deps, ORG, UID, id, parseTransactionPatch({ counterpartyId: 'cp1' }))
    expect((await txDoc(id))?.autoRules).toBeUndefined()
  })

  it('an edit of something else (the comment) keeps it', async () => {
    const id = await ruled()
    await updateTransaction(deps, ORG, UID, id, parseTransactionPatch({ description: 'ORLEN Gdańsk' }))
    expect((await txDoc(id))?.autoRules).toEqual([RULE])
  })

  it('a write by the rules adds to the trace once per rule and is marked via rule', async () => {
    const id = await ruled()
    await updateTransaction(deps, ORG, UID, id, parseTransactionPatch({ counterpartyId: 'cp1' }), { autoRules: [{ id: 'r2', name: 'Orlen' }, RULE] })
    expect((await txDoc(id))?.autoRules).toEqual([RULE, { id: 'r2', name: 'Orlen' }])
    const [entry] = await auditOf(id, 'tx.update')
    expect(entry).toMatchObject({ via: 'rule' })
  })

  it('refuses with conflict and writes nothing when the operation changed after the given version', async () => {
    const id = await ruled()
    const seen = await versionOf(id)
    await updateTransaction(deps, ORG, UID, id, parseTransactionPatch({ description: 'changed by a person' }))
    await expect(
      updateTransaction(deps, ORG, UID, id, parseTransactionPatch({ counterpartyId: 'cp1' }), { autoRules: [RULE], expectVersion: seen }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await txDoc(id))?.counterpartyId).toBeUndefined()
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
