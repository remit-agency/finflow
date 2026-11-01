import { beforeEach, describe, expect, it } from 'vitest'
import { draftToBody, draftToPatch } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import { bankRestoreOf } from '@/lib/api/transaction-undo'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, type TransactionInput } from '@/lib/domain/ledger/input'
import { flatten } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { makeTransfer, splitTransfer } from '@/lib/server/ledger/transfer'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, fakeResolveRate, makeDeps, readDoc, seedAccount, seedOrg, seedTag, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const txDoc = (id: string) => readDoc(db, `organizations/${ORG}/transactions/${id}`)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

async function stored(id: string): Promise<LedgerTransaction> {
  const snap = await db.doc(`organizations/${ORG}/transactions/${id}`).get()
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx) throw new Error(`unreadable ${id}`)
  return tx
}

async function balances(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of ['mil', 'mono', 'cash', 'cash2', 'eur']) out[id] = await balanceOf(db, ORG, id)
  return out
}

/** Every rollup document with its non-zero fields. */
async function allRollups(): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  for (const d of (await db.collection(`organizations/${ORG}/rollups`).get()).docs) {
    const flat = Object.fromEntries(Object.entries(flatten(d.data())).filter(([, v]) => v !== 0))
    if (Object.keys(flat).length > 0) out[d.id] = flat
  }
  return out
}

/** The undo of a delete as the browser sends it: the draft under the operation's id, plus what a bank transfer adds. */
function restoreInput(tx: LedgerTransaction, over: Record<string, unknown> = {}): TransactionInput {
  const ui = toUiTransaction(ORG, tx)
  const body = { ...JSON.parse(JSON.stringify({ ...draftToBody(transactionToDraft(ui), ui.id), ...bankRestoreOf(ui) })), ...over }
  return parseTransactionInput(body, { internal: true })
}

/** A bank pair of mil → mono, merged; the income on `inDay`. */
async function mergedPair(inDay = '2026-10-20') {
  const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
  const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: inDay })
  return { out, inc }
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 0)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
  await seedAccount(db, ORG, 'cash2', 'PLN', 0)
  await seedAccount(db, ORG, 'eur', 'EUR', 100_000)
  await seedTag(db, ORG, 'q4', { name: 'Q4' })
})

describe('splitTransfer', () => {
  it('a merged pair comes back as its two bank operations: the balances and the rollups are those before the merge', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const beforeBalances = await balances()
    const beforeRollups = await allRollups()
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })

    const { restored } = await splitTransfer(deps, ORG, UID, out.id)
    expect(restored.map((t) => `${t.id}:${t.type}`)).toEqual([`${out.id}:expense`, `${inc.id}:income`])
    expect(await stored(out.id)).toMatchObject({ type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20', bank: out.bank })
    expect(await stored(inc.id)).toMatchObject({ type: 'income', accountId: 'mono', paymentDate: '2026-10-22', bank: inc.bank, description: inc.bank?.remittance })
    expect((await stored(out.id)).bankTo).toBeUndefined()
    expect(await balances()).toEqual(beforeBalances)
    expect(await allRollups()).toEqual(beforeRollups)
    expect(await readDoc(db, `organizations/${ORG}/bankSeen/${KEY(2)}`)).toBeDefined()
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    const audit = await db.collection(`organizations/${ORG}/audit`).where('action', '==', 'tx.create').where('via', '==', 'transfer').get()
    expect(audit.docs.map((d) => d.get('targetId'))).toEqual([inc.id])
  })

  it('a converted expense and a converted income come back alone, and the cash box is back where it was', async () => {
    const atm = await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const deposit = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    const before = await balances()
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })
    expect(await balanceOf(db, ORG, 'cash')).toBe(70_000)

    expect((await splitTransfer(deps, ORG, UID, atm.id)).restored).toHaveLength(1)
    expect((await splitTransfer(deps, ORG, UID, deposit.id)).restored).toHaveLength(1)
    expect(await stored(atm.id)).toEqual(atm)
    expect(await stored(deposit.id)).toEqual(deposit)
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a side in another currency gets its rates again', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'eur', amountMinor: 10_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mil', amountMinor: 44_000, paymentDate: '2026-10-20' })
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    await splitTransfer(deps, ORG, UID, out.id)
    expect((await stored(out.id)).base).toEqual(out.base)
    expect((await stored(out.id)).fx).toEqual(out.fx)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses when the transfer changed while the rates were resolved, and writes nothing', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'eur', amountMinor: 10_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mil', amountMinor: 44_000, paymentDate: '2026-10-20' })
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    const rates = fakeResolveRate()
    let touched = false
    const racing = makeDeps(db, {
      resolveRate: async (from, to, date) => {
        if (!touched) {
          touched = true
          await updateTransaction(deps, ORG, UID, out.id, { description: 'W międzyczasie' })
        }
        return rates(from, to, date)
      },
    })
    expect(await code(splitTransfer(racing, ORG, UID, out.id))).toBe('conflict:undefined')
    expect(await stored(out.id)).toMatchObject({ type: 'transfer', description: 'W międzyczasie' })
    expect(await txDoc(inc.id)).toBeUndefined()
  })

  it('refuses a manual transfer, an income, a missing operation and an income id that is taken', async () => {
    const manual = await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'transfer', accountId: 'mil', toAccountId: 'cash', amountMinor: 500, paymentDate: '2026-10-20' }))
    expect(await code(splitTransfer(deps, ORG, UID, manual.transaction.id))).toBe('not_eligible:undefined')
    const income = await importBankOp(db, deps, { key: KEY(9), type: 'income', accountId: 'mil', amountMinor: 1, paymentDate: '2026-10-20' })
    expect(await code(splitTransfer(deps, ORG, UID, income.id))).toBe('not_eligible:undefined')
    expect(await code(splitTransfer(deps, ORG, UID, 'gone-12345678'))).toBe('not_found:undefined')

    const { out, inc } = await mergedPair()
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    await db.doc(`organizations/${ORG}/transactions/${inc.id}`).set({ placeholder: true })
    expect(await code(splitTransfer(deps, ORG, UID, out.id))).toBe('conflict:undefined')
    expect(await stored(out.id)).toMatchObject({ type: 'transfer' })
  })
})

describe('the undo of a deleted bank transfer', () => {
  it('a merged pair with its arrival day, a deposit and a converted expense come back as they were, from the marks', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    const deposit = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    const depositTransfer = (await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })).transaction
    const atm = await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const atmTransfer = (await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })).transaction
    await updateTransaction(deps, ORG, UID, pair.id, { tags: ['q4'], description: 'Własny' })
    const tagged = await stored(pair.id)
    const before = await balances()

    for (const tx of [tagged, depositTransfer, atmTransfer]) {
      await deleteTransaction(deps, ORG, UID, tx.id)
      await createTransaction(deps, ORG, UID, restoreInput(tx))
      expect(await stored(tx.id)).toEqual(tx)
    }
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses a restore that names another arrival day or another incoming side, and writes nothing', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    await deleteTransaction(deps, ORG, UID, pair.id)
    const before = await balances()
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair, { toDate: '2026-10-21' })))).toBe('invalid_input:clientId')
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair, { bankToKey: KEY(7) })))).toBe('invalid_input:clientId')
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair, { toAccountId: 'cash' })))).toBe('invalid_input:clientId')
    expect(await txDoc(pair.id)).toBeUndefined()
    expect(await balances()).toEqual(before)
  })

  it('never counts a bank operation twice: a merged income cannot come back on its own, nor a transfer whose income is back', async () => {
    const { out, inc } = await mergedPair()
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    const incomeAlone = parseTransactionInput({ clientId: inc.id, type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20' }, { internal: true })
    expect(await code(createTransaction(deps, ORG, UID, incomeAlone))).toBe('invalid_input:clientId')

    // The transfer is deleted and the income comes back alone (its mark allows it now); the transfer then cannot come back.
    await deleteTransaction(deps, ORG, UID, pair.id)
    await createTransaction(deps, ORG, UID, incomeAlone)
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair)))).toBe('invalid_input:clientId')
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})

describe('an edit of a bank transfer', () => {
  it('keeps both bank sides and the arrival day; a full replace with the same draft (the undo of an edit) passes', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    await updateTransaction(deps, ORG, UID, pair.id, { description: 'Własny', tags: ['q4'] })
    expect(await stored(pair.id)).toMatchObject({ description: 'Własny', tags: ['q4'], bank: pair.bank, bankTo: pair.bankTo, toDate: '2026-10-22' })
    await updateTransaction(deps, ORG, UID, pair.id, draftToPatch(transactionToDraft(toUiTransaction(ORG, pair))), { restore: true })
    expect(await stored(pair.id)).toEqual(pair)
  })

  it('refuses a change of a bank side; the account of the side that is not from a bank may change', async () => {
    const { out, inc } = await mergedPair()
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    expect(await code(updateTransaction(deps, ORG, UID, pair.id, { toAccountId: 'cash' }))).toBe('bank_locked:toAccountId')
    expect(await code(updateTransaction(deps, ORG, UID, pair.id, { paymentDate: '2026-10-19' }))).toBe('bank_locked:paymentDate')

    const deposit = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })
    expect(await code(updateTransaction(deps, ORG, UID, deposit.id, { toAccountId: 'cash2' }))).toBe('bank_locked:toAccountId')
    await updateTransaction(deps, ORG, UID, deposit.id, { accountId: 'cash2' })
    expect(await balanceOf(db, ORG, 'cash')).toBe(0)
    expect(await balanceOf(db, ORG, 'cash2')).toBe(-30_000)
    expect((await stored(deposit.id)).bankTo).toEqual({ key: KEY(4), ...deposit.bank })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})

describe('two restores of one deleted transfer at once', () => {
  it('lets exactly one of them come back: the income is counted once, the balance moves once and the ledger checks clean', async () => {
    const { out, inc } = await mergedPair()
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    await deleteTransaction(deps, ORG, UID, pair.id)
    const before = await balanceOf(db, ORG, 'mono')
    // The undo of the transfer and the undo of its income, sent together: each reads the bank sides before the other writes.
    const results = await Promise.all([
      code(createTransaction(deps, ORG, UID, restoreInput(pair))),
      code(createTransaction(deps, ORG, UID, restoreInput(inc))),
    ])
    expect(results.filter((r) => r === 'none')).toHaveLength(1)
    expect(await balanceOf(db, ORG, 'mono')).toBe(before + 100_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
