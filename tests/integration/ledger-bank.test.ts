import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)
const bank = { accountRef: 'ba1', entryReference: 'ref-1', counterpartyName: 'ACME', remittance: 'Faktura 1' }

async function importOne(clientId = 'bk_00000000000000000000000000000001') {
  // A bank operation: the sync's internal parse (bk_ ids are internal), and the bank block it is imported with.
  return createTransaction(deps, ORG, UID, parseTransactionInput({ clientId, type: 'expense', accountId: 'a1', amountMinor: 12_300, paymentDate: '2026-10-20' }, { internal: true }), bank)
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedCategory(db, ORG, 'k1', 'expense')
  await seedAccount(db, ORG, 'a1', 'PLN', 100_000)
  await seedAccount(db, ORG, 'a2', 'PLN', 0)
})

describe('operations imported from a bank', () => {
  it('stores source and bank, moves the balance, and a repeated create with the same clientId is a replay', async () => {
    const first = await importOne()
    expect(first.replayed).toBe(false)
    const doc = await readDoc(db, `organizations/${ORG}/transactions/${first.transaction.id}`)
    expect(doc?.source).toBe('bank')
    expect(doc?.bank).toEqual(bank)
    expect(await balanceOf(db, ORG, 'a1')).toBe(100_000 - 12_300)

    const again = await importOne()
    expect(again.replayed).toBe(true)
    expect(await balanceOf(db, ORG, 'a1')).toBe(100_000 - 12_300)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('an edit of category and description keeps the bank block', async () => {
    const { transaction } = await importOne()
    await updateTransaction(deps, ORG, UID, transaction.id, { categoryId: 'k1', description: 'Czynsz' })
    const doc = await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)
    expect(doc?.bank).toEqual(bank)
    expect(doc?.source).toBe('bank')
    expect(doc?.categoryId).toBe('k1')
  })

  it.each([
    ['amountMinor', { amountMinor: 999 }],
    ['paymentDate', { paymentDate: '2026-10-21' }],
    ['accountId', { accountId: 'a2' }],
    ['type', { type: 'income' }],
    ['status', { status: 'planned' }],
  ])('refuses to change %s with bank_locked and changes nothing', async (field, patch) => {
    const { transaction } = await importOne()
    await expect(updateTransaction(deps, ORG, UID, transaction.id, patch)).rejects.toMatchObject({ code: 'bank_locked', field })
    expect(await balanceOf(db, ORG, 'a1')).toBe(100_000 - 12_300)
  })

  it('a full patch that repeats the same locked values is accepted (the form sends everything)', async () => {
    const { transaction } = await importOne()
    await updateTransaction(deps, ORG, UID, transaction.id, { type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 12_300, paymentDate: '2026-10-20', description: 'ok' })
  })

  it('delete is allowed and puts the balance back', async () => {
    const { transaction } = await importOne()
    await deleteTransaction(deps, ORG, UID, transaction.id)
    expect(await balanceOf(db, ORG, 'a1')).toBe(100_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
