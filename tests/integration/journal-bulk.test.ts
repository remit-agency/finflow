import { beforeEach, describe, expect, it } from 'vitest'
import { parseBulkRequest } from '@/lib/domain/journal/bulk-input'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { runBulk } from '@/lib/server/journal/bulk'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)
// The runner takes the same two functions the production `ledger` object has.
const ledger = {
  updateTransaction: (orgId: string, uid: string, id: string, patch: Parameters<typeof updateTransaction>[4]) => updateTransaction(deps, orgId, uid, id, patch),
  deleteTransaction: (orgId: string, uid: string, id: string) => deleteTransaction(deps, orgId, uid, id),
}

async function make(extra: Record<string, unknown>): Promise<string> {
  const { transaction } = await createTransaction(
    deps,
    ORG,
    UID,
    parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 10_000, paymentDate: '2026-10-20', ...extra }),
  )
  return transaction.id
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedCategory(db, ORG, 'k1', 'expense')
  await seedCategory(db, ORG, 'k2', 'expense')
  await seedCounterparty(db, ORG, 'cp1')
  await seedCounterparty(db, ORG, 'cp-old', { archived: true })
  await seedAccount(db, ORG, 'a1', 'PLN', 100_000)
  await seedAccount(db, ORG, 'a2', 'PLN', 0)
})

describe('runBulk', () => {
  it('sets a category on several operations; each id gets its own outcome; the ledger stays consistent', async () => {
    const ids = [await make({}), await make({ amountMinor: 2_500 }), await make({ paymentDate: '2026-10-21' })]
    const out = await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids, patch: { categoryId: 'k1' } }))
    expect(out).toEqual(ids.map((id) => ({ id, ok: true })))
    for (const id of ids) expect((await readDoc(db, `organizations/${ORG}/transactions/${id}`))?.categoryId).toBe('k1')
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a failing row does not stop the rest: archived counterparty, unknown id, a transfer that cannot take a category', async () => {
    const good = await make({})
    const transfer = (await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'transfer', accountId: 'a1', toAccountId: 'a2', amountMinor: 1_000, paymentDate: '2026-10-20' }))).transaction.id
    const out = await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids: [transfer, 'missing', good], patch: { categoryId: 'k2' } }))
    expect(out[0]).toMatchObject({ id: transfer, ok: false })
    expect(out[1]).toEqual({ id: 'missing', ok: false, code: 'not_found' })
    expect(out[2]).toEqual({ id: good, ok: true })

    const archived = await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids: [good], patch: { counterpartyId: 'cp-old' } }))
    expect(archived).toEqual([{ id: good, ok: false, code: 'counterparty_archived' }])
  })

  it('moves the payment date: balances and rollups are the ones a single edit gives', async () => {
    const id = await make({})
    await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids: [id], patch: { paymentDate: '2026-10-22', description: 'przesunięte' } }))
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect((await readDoc(db, `organizations/${ORG}/transactions/${id}`))?.paymentDate).toBe('2026-10-22')
    expect(await balanceOf(db, ORG, 'a1')).toBe(90_000)
  })

  it('refuses an actual operation moved into the future, per row', async () => {
    const id = await make({})
    const out = await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids: [id], patch: { paymentDate: '2026-12-31' } }))
    expect(out).toEqual([{ id, ok: false, code: 'future_actual' }])
  })

  it('deletes several operations and the balance comes back', async () => {
    const ids = [await make({}), await make({ amountMinor: 3_333 })]
    expect(await balanceOf(db, ORG, 'a1')).toBe(100_000 - 13_333)
    const out = await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'delete', ids }))
    expect(out.every((o) => o.ok)).toBe(true)
    expect(await balanceOf(db, ORG, 'a1')).toBe(100_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
