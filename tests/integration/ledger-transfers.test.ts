import { beforeEach, describe, expect, it } from 'vitest'
import type { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { bankTxKeys } from '@/lib/server/banking/key'
import { syncStep } from '@/lib/server/banking/sync'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { makeTransfer } from '@/lib/server/ledger/transfer'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, seedTag, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const txDoc = (id: string) => readDoc(db, `organizations/${ORG}/transactions/${id}`)
const mark = (key: string) => readDoc(db, `organizations/${ORG}/bankSeen/${key}`)
const versionOf = async (id: string) => (await db.doc(`organizations/${ORG}/transactions/${id}`).get()).updateTime as Timestamp

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

async function balances(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of ['mil', 'mono', 'cash', 'eur']) out[id] = await balanceOf(db, ORG, id)
  return out
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 0)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
  await seedAccount(db, ORG, 'eur', 'EUR', 100_000)
  await seedCategory(db, ORG, 'k-ex', 'expense')
  await seedCategory(db, ORG, 'k-in', 'income')
  await seedTag(db, ORG, 'q4', { name: 'Q4' })
  await seedTag(db, ORG, 'vat', { name: 'ПДВ', excludeFromAnalytics: true })
})

describe('makeTransfer: a pair of bank operations', () => {
  it('merges an expense and an income of two accounts into one transfer: no balance moves, the income goes, its mark stays', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20', categoryId: 'k-ex', tags: ['q4'] })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20', categoryId: 'k-in' })
    const before = await balances()

    // In any order: the expense becomes the transfer.
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [inc.id, out.id] })
    expect(made).toMatchObject({ deletedId: inc.id, droppedTags: 0 })
    expect(made.before.map((t) => t.id)).toEqual([out.id, inc.id])
    expect(made.transaction).toMatchObject({
      id: out.id, type: 'transfer', accountId: 'mil', toAccountId: 'mono', amountMinor: 100_000, toAmountMinor: 100_000,
      tags: ['q4'], bank: out.bank, bankTo: { key: KEY(2), ...inc.bank },
    })
    expect(made.transaction.categoryId).toBeUndefined()
    expect(made.transaction.toDate).toBeUndefined()
    expect(await txDoc(out.id)).toMatchObject({ type: 'transfer', source: 'bank', bankTo: { key: KEY(2) } })
    expect(await txDoc(inc.id)).toBeUndefined()
    expect(await mark(KEY(2))).toBeDefined()

    expect(await balances()).toEqual(before)
    expect(await rollup(db, ORG, 'cash_mil_2026-10-20')).toEqual({ transferOutMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_mono_2026-10-20')).toEqual({ transferInMinor: 100_000 })
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({})
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({})
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)

    const audit = await db.collection(`organizations/${ORG}/audit`).where('via', '==', 'transfer').get()
    expect(audit.docs.map((d) => `${d.get('action')}:${d.get('targetId')}`).sort()).toEqual([`tx.delete:${inc.id}`, `tx.update:${out.id}`].sort())
  })

  it('puts the money in on the day the receiving bank booked it, and the from-scratch computation agrees', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-14' })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    expect(made.transaction.toDate).toBe('2026-10-14')
    expect(await rollup(db, ORG, 'cash_mil_2026-10-12')).toEqual({ transferOutMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_mono_2026-10-14')).toEqual({ transferInMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_mono_2026-10-12')).toEqual({})
    const report = await rebuildLedger(deps, ORG, UID, { apply: false })
    expect(report.ok).toBe(true)
    expect(report.rollupDiffs).toEqual([])

    // An arrival day one day off is a rollup difference verifyLedger reports.
    await db.doc(`organizations/${ORG}/transactions/${out.id}`).update({ toDate: '2026-10-15' })
    const drift = await verifyLedger(deps, ORG)
    expect(drift.ok).toBe(false)
    expect(drift.rollupDiffs.map((d) => d.docId)).toEqual(['cash_mono_2026-10-14', 'cash_mono_2026-10-15'])
  })

  it('across currencies keeps both real amounts and drops the rates of the expense', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'eur', amountMinor: 10_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mil', amountMinor: 44_000, paymentDate: '2026-10-21' })
    expect(out.base).toBeDefined()
    const before = await balances()
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    expect(made.transaction).toMatchObject({ accountId: 'eur', currency: 'EUR', amountMinor: 10_000, toAccountId: 'mil', toCurrency: 'PLN', toAmountMinor: 44_000, toDate: '2026-10-21' })
    expect(made.transaction.fx).toBeUndefined()
    expect(made.transaction.base).toBeUndefined()
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses a pair one of whose operations changed after the person saw it, and writes nothing', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const seen = [await versionOf(out.id), await versionOf(inc.id)] as const
    await updateTransaction(deps, ORG, UID, inc.id, { description: 'Zmieniony' })
    const before = await balances()
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id], versions: seen }))).toBe('conflict:undefined')
    expect(await txDoc(inc.id)).toMatchObject({ type: 'income', description: 'Zmieniony' })
    expect(await txDoc(out.id)).toMatchObject({ type: 'expense' })
    expect(await balances()).toEqual(before)

    // With the versions as they are now the same pair goes through.
    const now = [await versionOf(out.id), await versionOf(inc.id)] as const
    expect((await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id], versions: now })).deletedId).toBe(inc.id)
  })

  it('merges the tags (the expense first, at most 10) and takes `excluded` from all of them', async () => {
    const t = (n: number) => `t${String(n).padStart(2, '0')}`
    for (let n = 1; n <= 12; n++) await seedTag(db, ORG, t(n))
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100, paymentDate: '2026-10-20', tags: [1, 2, 3, 4, 5, 6].map(t) })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100, paymentDate: '2026-10-20', tags: [5, 6, 7, 8, 9, 10, 11, 12].map(t) })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    expect(made.transaction.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t))
    expect(made.droppedTags).toBe(2)

    const out2 = await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 500, paymentDate: '2026-10-21', tags: ['q4'] })
    const inc2 = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mono', amountMinor: 500, paymentDate: '2026-10-22', tags: ['vat'] })
    const excluded = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out2.id, inc2.id] })
    expect(excluded.transaction).toMatchObject({ tags: ['q4', 'vat'], excluded: true })
    expect(await rollup(db, ORG, 'x_cash_mil_2026-10-21')).toEqual({ transferOutMinor: 500 })
    expect(await rollup(db, ORG, 'x_cash_mono_2026-10-22')).toEqual({ transferInMinor: 500 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses what is not a pair of bank sides, and a pair whose income has no mark; nothing moves', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const manual = await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' }))
    const sameAccount = await importBankOp(db, deps, { key: KEY(3), type: 'income', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const otherExpense = await importBankOp(db, deps, { key: KEY(4), type: 'expense', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const tooLate = await importBankOp(db, deps, { key: KEY(5), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const otherAmount = await importBankOp(db, deps, { key: KEY(6), type: 'income', accountId: 'mono', amountMinor: 99_999, paymentDate: '2026-10-12' })
    const before = await balances()

    for (const other of [manual.transaction.id, sameAccount.id, otherExpense.id, tooLate.id, otherAmount.id]) {
      expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, other] })), other).toBe('not_eligible:undefined')
    }
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, 'gone-12345678'] }))).toBe('not_found:undefined')

    await db.doc(`organizations/${ORG}/bankSeen/${KEY(2)}`).delete()
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] }))).toBe('not_eligible:undefined')
    expect(await txDoc(inc.id)).toMatchObject({ type: 'income' })
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})

describe('makeTransfer: one bank operation', () => {
  it('a cash machine withdrawal becomes a transfer to the cash box: the bank balance stays, the cash box gets the money', async () => {
    const atm = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20', categoryId: 'k-ex' })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })
    expect(made).toMatchObject({ deletedId: null, droppedTags: 0 })
    expect(made.before).toEqual([atm])
    expect(made.transaction).toMatchObject({ id: atm.id, type: 'transfer', accountId: 'mil', toAccountId: 'cash', bank: atm.bank })
    expect(made.transaction.bankTo).toBeUndefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(400_000)
    expect(await balanceOf(db, ORG, 'cash')).toBe(100_000)
    expect(await rollup(db, ORG, 'cash_mil_2026-10-20')).toEqual({ transferOutMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_cash_2026-10-20')).toEqual({ transferInMinor: 100_000 })
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({})
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a deposit (a bank income) becomes a transfer from the cash box whose incoming side is the bank one', async () => {
    const deposit = await importBankOp(db, deps, { key: KEY(5), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })
    expect(made.transaction).toMatchObject({ id: deposit.id, type: 'transfer', accountId: 'cash', toAccountId: 'mil', bankTo: { key: KEY(5), ...deposit.bank } })
    expect(made.transaction.bank).toBeUndefined()
    expect((await txDoc(deposit.id))?.source).toBeUndefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(530_000)
    expect(await balanceOf(db, ORG, 'cash')).toBe(-30_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses a target fed by a bank, another currency, the same account, a missing account and an operation that is a transfer already', async () => {
    const atm = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    await db.doc(`organizations/${ORG}/bankAccounts/ba-mono`).set({ orgId: ORG, accountId: 'mono', status: 'disconnected' })
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'mono' }))).toBe('not_eligible:toAccountId')
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'eur' }))).toBe('currency_mismatch:toAccountId')
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'mil' }))).toBe('invalid_input:toAccountId')
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'nope' }))).toBe('account_not_found:toAccountId')
    expect(await txDoc(atm.id)).toMatchObject({ type: 'expense' })
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' }))).toBe('not_eligible:undefined')
  })
})

describe('the bank sync after a merge', () => {
  it('does not import the merged income again: its mark stays and the sync only adds what it has no mark for', async () => {
    await seedAccount(db, ORG, 'a1', 'PLN', 0)
    await seedBank(db)
    const r1 = ebTx('r1', '100.00', 'CRDT', '2026-10-20')
    const bank = bankDeps(db, fakeEb({ '': { transactions: [r1], continuationKey: null } }, '100.00'))
    await syncStep(bank, ORG, UID, 'ba1')
    const incomeId = `bk_${bankTxKeys('ba1', [r1])[0].key}`
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 10_000, paymentDate: '2026-10-20' })
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, incomeId] })

    expect(await syncStep(bank, ORG, UID, 'ba1')).toMatchObject({ imported: 0, skipped: 1 })
    expect(await txDoc(incomeId)).toBeUndefined()
    expect(await txDoc(out.id)).toMatchObject({ type: 'transfer', toAccountId: 'a1' })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
