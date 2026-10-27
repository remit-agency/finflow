import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCounterparty, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

const expense = (extra: Record<string, unknown> = {}) =>
  parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 1000, paymentDate: '2026-10-20', ...extra })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 5000)
})

describe('counterparty on an operation', () => {
  it('is stored when the counterparty exists', async () => {
    await seedCounterparty(db, ORG, 'c1')
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    expect((await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`))?.counterpartyId).toBe('c1')
  })

  it('an unknown counterparty is refused and nothing is written', async () => {
    expect(await code(createTransaction(deps, ORG, UID, expense({ counterpartyId: 'ghost' })))).toBe('counterparty_not_found:counterpartyId')
    expect((await db.collection(`organizations/${ORG}/transactions`).get()).size).toBe(0)
    expect(await balanceOf(db, ORG, 'a1')).toBe(5000)
  })

  it('an archived counterparty cannot be given to a new operation', async () => {
    await seedCounterparty(db, ORG, 'old', { archived: true })
    expect(await code(createTransaction(deps, ORG, UID, expense({ counterpartyId: 'old' })))).toBe('counterparty_archived:counterpartyId')
  })

  it('an edit that switches to an unknown or archived counterparty is refused and leaves the operation as it was', async () => {
    await seedCounterparty(db, ORG, 'c1')
    await seedCounterparty(db, ORG, 'old', { archived: true })
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    const current = async () => (await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`))?.counterpartyId
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ counterpartyId: 'ghost' })))).toBe('counterparty_not_found:counterpartyId')
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ counterpartyId: 'old' })))).toBe('counterparty_archived:counterpartyId')
    expect(await current()).toBe('c1')
  })

  it('an edit of something else does not re-check a counterparty that was archived since', async () => {
    await seedCounterparty(db, ORG, 'c1')
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    await db.doc(`organizations/${ORG}/counterparties/c1`).update({ archived: true })
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ description: 'still fine' }))
    expect(await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)).toMatchObject({ counterpartyId: 'c1', description: 'still fine' })
  })

  it('an edit may clear the counterparty', async () => {
    await seedCounterparty(db, ORG, 'c1')
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ counterpartyId: null }))
    expect((await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`))?.counterpartyId).toBeUndefined()
  })
})
