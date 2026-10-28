import { beforeEach, describe, expect, it } from 'vitest'
import { draftToBody, draftToPatch } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import type { Transaction } from '@/types'
import {
  ORG,
  UID,
  balanceOf,
  clearFirestore,
  makeDeps,
  readDoc,
  seedAccount,
  seedCategory,
  seedCounterparty,
  seedOrg,
  testDb,
} from './helpers'

const db = testDb()
const deps = makeDeps(db)

/** The wire the browser uses: a draft becomes a JSON body that the server parses as a create or a full replace. */
const asCreate = (tx: Transaction) => parseTransactionInput(JSON.parse(JSON.stringify(draftToBody(transactionToDraft(tx), tx.id))))
const asReplace = (tx: Transaction) => parseTransactionPatch(JSON.parse(JSON.stringify(draftToPatch(transactionToDraft(tx)))))

/** Rollup documents as stored, without leaves that hold 0: an edit that moves an amount away from a bucket leaves that bucket at 0, which says the same as no bucket. */
function withoutZeros(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const entries = Object.entries(value).flatMap(([key, child]): [string, unknown][] => {
    const pruned = withoutZeros(child)
    if (pruned === 0) return []
    if (typeof pruned === 'object' && pruned !== null && Object.keys(pruned).length === 0) return []
    return [[key, pruned]]
  })
  return Object.fromEntries(entries)
}

async function rollups(): Promise<Record<string, unknown>> {
  const snap = await db.collection(`organizations/${ORG}/rollups`).get()
  return withoutZeros(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))) as Record<string, unknown>
}

const VOLATILE = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy']

/** The stored operation without the fields that legitimately change on a rewrite. */
async function stored(id: string): Promise<Record<string, unknown>> {
  const doc = (await readDoc(db, `organizations/${ORG}/transactions/${id}`)) ?? {}
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !VOLATILE.includes(key)))
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedCategory(db, ORG, 'c1', 'expense')
  await seedCounterparty(db, ORG, 'cp1')
  await seedAccount(db, ORG, 'a1', 'PLN', 5000)
  await seedAccount(db, ORG, 'a2', 'EUR', 1000)
})

async function create(extra: Record<string, unknown>): Promise<Transaction> {
  const { transaction } = await createTransaction(
    deps,
    ORG,
    UID,
    parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 12050, paymentDate: '2026-10-20', ...extra }),
  )
  return toUiTransaction(ORG, transaction)
}

describe('undo of a delete (create again under the same id)', () => {
  it('gives back the same balance, rollups and operation, and the ledger still verifies', async () => {
    const tx = await create({
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    const balanceBefore = await balanceOf(db, ORG, 'a1')
    const rollupsBefore = await rollups()
    const docBefore = await stored(tx.id)

    await deleteTransaction(deps, ORG, UID, tx.id)
    expect(await balanceOf(db, ORG, 'a1')).toBe(5000)

    await createTransaction(deps, ORG, UID, asCreate(tx))

    expect(await balanceOf(db, ORG, 'a1')).toBe(balanceBefore)
    expect(await rollups()).toEqual(rollupsBefore)
    expect(await stored(tx.id)).toEqual(docBefore)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true, balanceDiffs: [], rollupDiffs: [] })
  })

  it('restores an operation in a foreign currency with the same converted amounts', async () => {
    const tx = await create({ accountId: 'a2', amountMinor: 10000, paymentDate: '2026-10-20' })
    const rollupsBefore = await rollups()
    const docBefore = await stored(tx.id)

    await deleteTransaction(deps, ORG, UID, tx.id)
    await createTransaction(deps, ORG, UID, asCreate(tx))

    expect(await rollups()).toEqual(rollupsBefore)
    expect(await stored(tx.id)).toEqual(docBefore)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true })
  })

  it('restores a planned operation, which never touched the balance', async () => {
    const tx = await create({ status: 'planned', paymentDate: '2026-12-01' })
    await deleteTransaction(deps, ORG, UID, tx.id)
    await createTransaction(deps, ORG, UID, asCreate(tx))
    expect(await balanceOf(db, ORG, 'a1')).toBe(5000)
    expect(await stored(tx.id)).toMatchObject({ status: 'planned', paymentDate: '2026-12-01' })
  })

  it('a restore of a transfer returns both balances', async () => {
    const { transaction } = await createTransaction(
      deps,
      ORG,
      UID,
      parseTransactionInput({ type: 'transfer', accountId: 'a1', toAccountId: 'a2', amountMinor: 44000, toAmountMinor: 10000, paymentDate: '2026-10-20' }),
    )
    const tx = toUiTransaction(ORG, transaction)
    const balances = [await balanceOf(db, ORG, 'a1'), await balanceOf(db, ORG, 'a2')]
    await deleteTransaction(deps, ORG, UID, tx.id)
    await createTransaction(deps, ORG, UID, asCreate(tx))
    expect([await balanceOf(db, ORG, 'a1'), await balanceOf(db, ORG, 'a2')]).toEqual(balances)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true })
  })
})

describe('undo of an edit (full replace with the earlier operation)', () => {
  it('brings back the amount, the counterparty, the accrual, the balance and the rollups', async () => {
    const tx = await create({
      categoryId: 'c1',
      counterpartyId: 'cp1',
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    const balanceBefore = await balanceOf(db, ORG, 'a1')
    const rollupsBefore = await rollups()
    const docBefore = await stored(tx.id)

    // The edit: another amount, no counterparty, the accrual back on the payment date.
    await updateTransaction(
      deps,
      ORG,
      UID,
      tx.id,
      parseTransactionPatch({ amountMinor: 5000, counterpartyId: null, accrual: null, categoryId: null }),
    )
    expect(await balanceOf(db, ORG, 'a1')).not.toBe(balanceBefore)

    await updateTransaction(deps, ORG, UID, tx.id, asReplace(tx))

    expect(await balanceOf(db, ORG, 'a1')).toBe(balanceBefore)
    expect(await rollups()).toEqual(rollupsBefore)
    expect(await stored(tx.id)).toEqual(docBefore)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true })
  })
})
