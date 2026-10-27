import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { acquireLock, releaseLock } from '@/lib/server/ledger/lock'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import {
  ORG, UID, auditActions, balanceOf, clearFirestore, fakeResolveRate, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, testDb,
} from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

const input = (over: Record<string, unknown>) =>
  parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 12345, paymentDate: '2026-10-20', ...over })
const patch = (over: Record<string, unknown>) => parseTransactionPatch(over)
const pl = (month: string) => rollup(db, ORG, `pl_${month}`)

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'pln1', 'PLN', 1000)
  await seedAccount(db, ORG, 'pln2', 'PLN', 0)
  await seedAccount(db, ORG, 'eur1', 'EUR', 0)
  await seedCategory(db, ORG, 'inc', 'income')
  await seedCategory(db, ORG, 'exp', 'expense')
})

describe('createTransaction', () => {
  it('writes the operation, the balance, the rollups and the audit entry together', async () => {
    const { transaction, replayed } = await createTransaction(deps, ORG, UID, input({ categoryId: 'inc' }))
    expect(replayed).toBe(false)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)

    const doc = await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)
    expect(doc).toMatchObject({ schemaVersion: 2, type: 'income', amountMinor: 12345, currency: 'PLN', paymentDate: '2026-10-20', orgId: ORG, createdBy: UID })

    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({ inMinor: 12345, inBase: 12345 })
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({ 'categories.inc.incomeBase': 12345 })
    expect(await pl('2026-10')).toEqual({ 'categories.inc.incomeBase': 12345 })
    expect(await auditActions(db, ORG)).toEqual(['tx.create'])
  })

  it('a repeated clientId returns the existing operation and changes nothing', async () => {
    const body = input({ clientId: 'client-aaaa1111' })
    const first = await createTransaction(deps, ORG, UID, body)
    const again = await createTransaction(deps, ORG, UID, body)
    expect(again.replayed).toBe(true)
    expect(again.transaction.id).toBe(first.transaction.id)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
    expect(await auditActions(db, ORG)).toEqual(['tx.create'])
  })

  it('spreads a period over the months in pl but keeps cash on the payment day', async () => {
    await createTransaction(deps, ORG, UID, input({
      type: 'expense', categoryId: 'exp', amountMinor: 1000, paymentDate: '2026-03-02',
      accrual: { mode: 'period', from: '2026-01-15', to: '2026-03-02' },
    }))
    expect(await pl('2026-01')).toEqual({ 'categories.exp.expenseBase': 361 })
    expect(await pl('2026-02')).toEqual({ 'categories.exp.expenseBase': 595 })
    expect(await pl('2026-03')).toEqual({ 'categories.exp.expenseBase': 44 })
    expect(await rollup(db, ORG, 'cash_pln1_2026-03-02')).toEqual({ outMinor: 1000, outBase: 1000 })
  })

  it('stores fx evidence and base amounts for another currency, asking one rate per distinct date', async () => {
    const calls: string[] = []
    const d = makeDeps(db, { resolveRate: fakeResolveRate(calls) })
    const same = await createTransaction(d, ORG, UID, input({ accountId: 'eur1', type: 'expense', amountMinor: 1000 }))
    expect(calls).toEqual(['EUR>PLN@2026-10-20'])
    expect(same.transaction.base).toEqual({ payment: 4400, accrual: 4400 })
    expect(same.transaction.fx?.payment?.tableNo).toBe('T/2026-10-20')

    calls.length = 0
    const split = await createTransaction(d, ORG, UID, input({ accountId: 'eur1', type: 'expense', amountMinor: 1000, accrual: { mode: 'date', date: '2026-10-10' } }))
    expect(calls).toEqual(['EUR>PLN@2026-10-20', 'EUR>PLN@2026-10-10'])
    expect(split.transaction.base).toEqual({ payment: 4400, accrual: 4400 })
    expect(await rollup(db, ORG, 'cash_eur1_2026-10-20')).toMatchObject({ outMinor: 2000, outBase: 8800 })
  })

  it('a cross-currency transfer moves both amounts', async () => {
    await createTransaction(deps, ORG, UID, input({ type: 'transfer', accountId: 'pln1', toAccountId: 'eur1', amountMinor: 440, toAmountMinor: 100 }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(560)
    expect(await balanceOf(db, ORG, 'eur1')).toBe(100)
    expect(await rollup(db, ORG, 'cash_eur1_2026-10-20')).toEqual({ transferInMinor: 100 })
    expect(await pl('2026-10')).toEqual({})
  })

  it('a planned operation changes nothing but is stored; patching it to actual applies it', async () => {
    const planned = await createTransaction(deps, ORG, UID, input({ status: 'planned', paymentDate: '2026-11-15' }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await rollup(db, ORG, 'cash_pln1_2026-11-15')).toEqual({})

    await updateTransaction(deps, ORG, UID, planned.transaction.id, patch({ status: 'actual', paymentDate: '2026-10-27' }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-27')).toEqual({ inMinor: 12345, inBase: 12345 })
  })

  it.each([
    ['an actual operation after today', { paymentDate: '2026-10-28' }, 'future_actual:paymentDate'],
    ['an unknown account', { accountId: 'ghost' }, 'account_not_found:accountId'],
    ['an unknown category', { categoryId: 'ghost' }, 'category_not_found:categoryId'],
    ['a category of the other type', { categoryId: 'exp' }, 'category_not_found:categoryId'],
  ])('refuses %s', async (_l, over, expected) => {
    expect(await code(createTransaction(deps, ORG, UID, input(over)))).toBe(expected)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await auditActions(db, ORG)).toEqual([])
  })

  it('answers ledger_busy while the ledger is locked and works again after the lock is released', async () => {
    const token = await acquireLock(deps, ORG, 'test')
    expect(await code(createTransaction(deps, ORG, UID, input({})))).toBe('ledger_busy:undefined')
    await releaseLock(deps, ORG, token)
    await createTransaction(deps, ORG, UID, input({}))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
  })

  it('an expired lock does not block', async () => {
    await acquireLock(deps, ORG, 'test')
    const later = makeDeps(db, { now: () => new Date('2026-10-27T10:06:00Z') })
    await createTransaction(later, ORG, UID, input({}))
  })
})

describe('updateTransaction', () => {
  it('the screenshot case: editing the amount moves the balance by the difference', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ amountMinor: 123450 }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(124450)
    await updateTransaction(deps, ORG, UID, transaction.id, patch({ amountMinor: 123460 }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(124460)
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({ inMinor: 123460, inBase: 123460 })
  })

  it('moving an operation to another account, type and date rebalances both accounts and the rollups', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ type: 'income', categoryId: 'inc' }))
    await updateTransaction(deps, ORG, UID, transaction.id, patch({
      type: 'expense', accountId: 'pln2', categoryId: 'exp', paymentDate: '2026-09-05',
    }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await balanceOf(db, ORG, 'pln2')).toBe(-12345)
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({})
    expect(await pl('2026-09')).toEqual({ 'categories.exp.expenseBase': 12345 })
    expect(await pl('2026-10')).toEqual({})
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.update'])
  })

  it('clearing a field with null and following the payment date for the accrual', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ categoryId: 'inc', description: 'x' }))
    const out = await updateTransaction(deps, ORG, UID, transaction.id, patch({ categoryId: null, description: null, paymentDate: '2026-10-21' }))
    expect(out.transaction.categoryId).toBeUndefined()
    expect(out.transaction.accrual).toEqual({ mode: 'date', date: '2026-10-21' })
    const doc = await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)
    expect(doc).not.toHaveProperty('categoryId')
    expect(doc).toMatchObject({ createdBy: UID, updatedBy: UID })
  })

  it('an unknown or deleted operation is not_found', async () => {
    expect(await code(updateTransaction(deps, ORG, UID, 'nope', patch({ amountMinor: 5 })))).toBe('not_found:undefined')
  })

  it('an invalid merged result is refused and nothing changes', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({}))
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, patch({ type: 'transfer' })))).toBe('invalid_input:toAccountId')
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
  })
})

describe('deleteTransaction', () => {
  it('reverses the balance and the rollups and keeps an audit trail', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ categoryId: 'inc' }))
    await deleteTransaction(deps, ORG, UID, transaction.id)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)).toBeUndefined()
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({})
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.delete'])
    expect(await code(deleteTransaction(deps, ORG, UID, transaction.id))).toBe('not_found:undefined')
  })
})
