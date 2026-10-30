import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, seedTag, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

/** An expense of 230 zł from the bank on 2026-10-20 with a category; `extra` replaces fields. */
const op = (extra: Record<string, unknown> = {}) =>
  parseTransactionInput({ type: 'expense', accountId: 'bank', amountMinor: 23_000, paymentDate: '2026-10-20', categoryId: 'k-ex', ...extra })
const txDoc = (id: string) => readDoc(db, `organizations/${ORG}/transactions/${id}`)

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
  await seedAccount(db, ORG, 'bank', 'PLN', 100_000)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
  await seedCategory(db, ORG, 'k-ex', 'expense')
  await seedCategory(db, ORG, 'k-in', 'income')
  await seedCategory(db, ORG, 'k-fuel', 'expense')
  await seedTag(db, ORG, 'vat', { name: 'ПДВ', excludeFromAnalytics: true })
  await seedTag(db, ORG, 'atm', { name: 'Bankomat', excludeFromAnalytics: true })
  await seedTag(db, ORG, 'q4', { name: 'Q4' })
  await seedTag(db, ORG, 'old', { name: 'Stary', archived: true })
})

describe('tags on an operation', () => {
  it('an excluding tag sends the operation to the x_ rollups; the balance moves exactly as without the tag', async () => {
    const tagged = await createTransaction(deps, ORG, UID, op({ tags: ['vat'] }))
    expect(tagged.transaction.excluded).toBe(true)
    expect(await txDoc(tagged.transaction.id)).toMatchObject({ tags: ['vat'], excluded: true })
    expect(await rollup(db, ORG, 'x_cash_bank_2026-10-20')).toEqual({ outMinor: 23_000, outBase: 23_000 })
    expect(await rollup(db, ORG, 'x_cashcat_2026-10')).toEqual({ 'categories.k-ex.expenseBase': 23_000 })
    expect(await rollup(db, ORG, 'x_pl_2026-10')).toEqual({ 'categories.k-ex.expenseBase': 23_000 })
    expect(await rollup(db, ORG, 'cash_bank_2026-10-20')).toEqual({})
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({})
    const afterTagged = await balanceOf(db, ORG, 'bank')

    // The same operation without the tag: the balance moves by the same amount, the analytics rollups get it.
    await createTransaction(deps, ORG, UID, op())
    expect(afterTagged).toBe(100_000 - 23_000)
    expect(await balanceOf(db, ORG, 'bank')).toBe(100_000 - 2 * 23_000)
    expect(await rollup(db, ORG, 'cash_bank_2026-10-20')).toEqual({ outMinor: 23_000, outBase: 23_000 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a tag without the flag changes nothing in the rollups', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, op({ tags: ['q4'] }))
    expect(transaction.excluded).toBeUndefined()
    expect((await txDoc(transaction.id))?.excluded).toBeUndefined()
    expect(await rollup(db, ORG, 'cash_bank_2026-10-20')).toEqual({ outMinor: 23_000, outBase: 23_000 })
  })

  it('an unknown tag and an archived tag are refused and nothing is written', async () => {
    expect(await code(createTransaction(deps, ORG, UID, op({ tags: ['ghost'] })))).toBe('tag_not_found:tags')
    expect(await code(createTransaction(deps, ORG, UID, op({ tags: ['q4', 'old'] })))).toBe('tag_archived:tags')
    expect((await db.collection(`organizations/${ORG}/transactions`).get()).size).toBe(0)
    expect(await balanceOf(db, ORG, 'bank')).toBe(100_000)
  })

  it('an edit that keeps a tag archived since, or takes it off, is allowed; giving it anew is not', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, op({ tags: ['q4'] }))
    await db.doc(`organizations/${ORG}/tags/q4`).update({ archived: true })
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ description: 'still fine' }))
    expect(await txDoc(transaction.id)).toMatchObject({ tags: ['q4'], description: 'still fine' })
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ tags: [] }))
    expect((await txDoc(transaction.id))?.tags).toEqual([])
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ tags: ['q4'] })))).toBe('tag_archived:tags')
  })

  it('the undo of a removal restores the archived tag only with the restore marker; a tag that no longer exists is still refused', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, op({ tags: ['q4'] }))
    await db.doc(`organizations/${ORG}/tags/q4`).update({ archived: true })
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ tags: [] }))
    const back = parseTransactionPatch({ tags: ['q4'] })

    // The same full replace as the undo, without the marker: refused as a new assignment of an archived tag.
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, back))).toBe('tag_archived:tags')
    expect((await txDoc(transaction.id))?.tags).toEqual([])

    // With the marker (the undo's restore of a previous state) the archived tag comes back.
    await updateTransaction(deps, ORG, UID, transaction.id, back, { restore: true })
    expect(await txDoc(transaction.id)).toMatchObject({ tags: ['q4'] })
    expect((await txDoc(transaction.id))?.excluded).toBeUndefined()

    // The marker accepts only tags that exist.
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ tags: [] }))
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ tags: ['ghost'] }), { restore: true }))).toBe('tag_not_found:tags')
    expect((await txDoc(transaction.id))?.tags).toEqual([])
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('adding and taking off the excluding tag moves the rollups between the twins; the balance never moves', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, op())
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ tags: ['vat'] }))
    expect(await balanceOf(db, ORG, 'bank')).toBe(77_000)
    expect(await rollup(db, ORG, 'cash_bank_2026-10-20')).toEqual({})
    expect(await rollup(db, ORG, 'x_cash_bank_2026-10-20')).toEqual({ outMinor: 23_000, outBase: 23_000 })

    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ tags: [] }))
    expect((await txDoc(transaction.id))?.excluded).toBeUndefined()
    expect(await rollup(db, ORG, 'x_cash_bank_2026-10-20')).toEqual({})
    expect(await rollup(db, ORG, 'cash_bank_2026-10-20')).toEqual({ outMinor: 23_000, outBase: 23_000 })
    expect(await balanceOf(db, ORG, 'bank')).toBe(77_000)

    await deleteTransaction(deps, ORG, UID, transaction.id)
    expect(await balanceOf(db, ORG, 'bank')).toBe(100_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a new operation takes the flag of its tags as they are at the write', async () => {
    await db.doc(`organizations/${ORG}/tags/q4`).update({ excludeFromAnalytics: true })
    expect((await createTransaction(deps, ORG, UID, op({ tags: ['q4'] }))).transaction.excluded).toBe(true)
  })

  it('a request cannot set excluded itself', () => {
    expect(() => parseTransactionInput({ type: 'expense', accountId: 'bank', amountMinor: 1, paymentDate: '2026-10-20', excluded: true })).toThrow(LedgerError)
  })
})

describe('the owner scenarios (2026-10-29)', () => {
  it('a VAT pair with the tag: the analytics rollups show only the real sale, the bank balance is what the bank says', async () => {
    await createTransaction(deps, ORG, UID, op({ type: 'income', categoryId: 'k-in', tags: ['vat'] }))
    await createTransaction(deps, ORG, UID, op({ tags: ['vat'] }))
    await createTransaction(deps, ORG, UID, op({ type: 'income', categoryId: 'k-in', amountMinor: 100_000 }))
    expect(await rollup(db, ORG, 'cash_bank_2026-10-20')).toEqual({ inMinor: 100_000, inBase: 100_000 })
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({ 'categories.k-in.incomeBase': 100_000 })
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({ 'categories.k-in.incomeBase': 100_000 })
    expect(await balanceOf(db, ORG, 'bank')).toBe(100_000 + 23_000 - 23_000 + 100_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('the cash machine: −1000 from the bank and +1000 into the cash box with the tag leave the P&L alone; the real spending from the cash box counts', async () => {
    await createTransaction(deps, ORG, UID, op({ amountMinor: 100_000, categoryId: undefined, tags: ['atm'] }))
    await createTransaction(deps, ORG, UID, op({ type: 'income', accountId: 'cash', amountMinor: 100_000, categoryId: undefined, tags: ['atm'] }))
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({})
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({})
    expect(await balanceOf(db, ORG, 'bank')).toBe(0)
    expect(await balanceOf(db, ORG, 'cash')).toBe(100_000)

    await createTransaction(deps, ORG, UID, op({ accountId: 'cash', amountMinor: 100_000, categoryId: 'k-fuel', description: 'benzyna' }))
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({ 'categories.k-fuel.expenseBase': 100_000 })
    expect(await balanceOf(db, ORG, 'cash')).toBe(0)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})

describe('verify and rebuild', () => {
  it('verify reports an operation whose stored flag disagrees with its tags; rebuild sets the flag and the x_ rollups', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, op({ tags: ['q4'] }))
    // The flag changed behind the ledger's back (as if the recalculation had not run yet).
    await db.doc(`organizations/${ORG}/tags/q4`).update({ excludeFromAnalytics: true })
    const report = await verifyLedger(deps, ORG)
    expect(report.ok).toBe(false)
    expect(report.excludedDiffs).toEqual([{ txId: transaction.id, stored: false, expected: true }])
    expect(report.balanceDiffs).toEqual([])

    const rebuilt = await rebuildLedger(deps, ORG, UID, { apply: true })
    expect(rebuilt.applied).toBe(true)
    expect((await txDoc(transaction.id))?.excluded).toBe(true)
    expect(await rollup(db, ORG, 'x_cash_bank_2026-10-20')).toEqual({ outMinor: 23_000, outBase: 23_000 })
    expect(await rollup(db, ORG, 'cash_bank_2026-10-20')).toEqual({})
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true, excludedDiffs: [], rollupDiffs: [], balanceDiffs: [] })
  })

  it('a tag that no longer exists does not exclude; rebuild clears a flag it does not justify', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, op({ tags: ['vat'] }))
    await db.doc(`organizations/${ORG}/tags/vat`).delete()
    expect((await verifyLedger(deps, ORG)).excludedDiffs).toEqual([{ txId: transaction.id, stored: true, expected: false }])
    await rebuildLedger(deps, ORG, UID, { apply: true })
    expect((await txDoc(transaction.id))?.excluded).toBeUndefined()
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
