import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBulkRequest } from '@/lib/domain/journal/bulk-input'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { runBulk } from '@/lib/server/journal/bulk'
import { verifyLedger } from '@/lib/server/ledger/verify'
import type { TagChange } from '@/lib/domain/tags/assign'
import { createTransaction, deleteTransaction, retagTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, seedTag, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)
// The runner takes the same two functions the production `ledger` object has.
const ledger = {
  updateTransaction: (orgId: string, uid: string, id: string, patch: Parameters<typeof updateTransaction>[4]) => updateTransaction(deps, orgId, uid, id, patch),
  deleteTransaction: (orgId: string, uid: string, id: string) => deleteTransaction(deps, orgId, uid, id),
  retagTransaction: (orgId: string, uid: string, id: string, change: TagChange) => retagTransaction(deps, orgId, uid, id, change),
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

  describe('an unexpected error on one row', () => {
    afterEach(() => vi.restoreAllMocks())

    it('becomes the row outcome `unknown`; the rows before and after are applied and the failure is logged once', async () => {
      const ids = [await make({}), await make({ amountMinor: 2_500 }), await make({ amountMinor: 700 })]
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const flaky = {
        ...ledger,
        updateTransaction: (orgId: string, uid: string, id: string, patch: Parameters<typeof updateTransaction>[4]) => {
          if (id === ids[1]) throw new Error('socket hang up')
          return ledger.updateTransaction(orgId, uid, id, patch)
        },
      }
      const out = await runBulk(flaky, ORG, UID, parseBulkRequest({ action: 'update', ids, patch: { categoryId: 'k1' } }))
      expect(out).toEqual([{ id: ids[0], ok: true }, { id: ids[1], ok: false, code: 'unknown' }, { id: ids[2], ok: true }])
      expect((await readDoc(db, `organizations/${ORG}/transactions/${ids[2]}`))?.categoryId).toBe('k1')
      expect((await readDoc(db, `organizations/${ORG}/transactions/${ids[1]}`))?.categoryId).toBeUndefined()
      expect(log).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(log.mock.calls[0])).toContain(ids[1])
    })

    it('a delete that throws a plain error is the same', async () => {
      const ids = [await make({}), await make({})]
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const flaky = {
        ...ledger,
        deleteTransaction: (orgId: string, uid: string, id: string) => (id === ids[0] ? Promise.reject(new TypeError('boom')) : ledger.deleteTransaction(orgId, uid, id)),
      }
      const out = await runBulk(flaky, ORG, UID, parseBulkRequest({ action: 'delete', ids }))
      expect(out).toEqual([{ id: ids[0], ok: false, code: 'unknown' }, { id: ids[1], ok: true }])
    })
  })

  describe('tags (S10t)', () => {
    it('adds and takes off a tag; the excluding tag moves the rollups only, the balance stays', async () => {
      await seedTag(db, ORG, 'vat', { excludeFromAnalytics: true })
      await seedTag(db, ORG, 'q4')
      const ids = [await make({}), await make({ tags: ['q4'] })]
      expect(await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids, patch: { addTagIds: ['vat'] } }))).toEqual(ids.map((id) => ({ id, ok: true })))
      expect(await readDoc(db, `organizations/${ORG}/transactions/${ids[0]}`)).toMatchObject({ tags: ['vat'], excluded: true })
      expect(await readDoc(db, `organizations/${ORG}/transactions/${ids[1]}`)).toMatchObject({ tags: ['q4', 'vat'], excluded: true })
      expect(await balanceOf(db, ORG, 'a1')).toBe(100_000 - 20_000)

      await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids, patch: { removeTagIds: ['vat'] } }))
      const second = await readDoc(db, `organizations/${ORG}/transactions/${ids[1]}`)
      expect(second?.tags).toEqual(['q4'])
      expect(second?.excluded).toBeUndefined()
      expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    })

    it('a change that leaves the list as it is writes nothing; an archived tag fails only its row', async () => {
      await seedTag(db, ORG, 'q4')
      await seedTag(db, ORG, 'old', { archived: true })
      const id = await make({ tags: ['q4'] })
      const before = (await auditActions(db, ORG)).length
      expect(await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids: [id], patch: { addTagIds: ['q4'] } }))).toEqual([{ id, ok: true }])
      expect((await auditActions(db, ORG)).length).toBe(before)
      expect(await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids: [id], patch: { addTagIds: ['old'] } }))).toEqual([{ id, ok: false, code: 'tag_archived' }])
    })

    it('stops at 10 tags: the extra ones are not added', async () => {
      for (let i = 0; i <= 10; i++) await seedTag(db, ORG, `t${i}`)
      const id = await make({ tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })
      await runBulk(ledger, ORG, UID, parseBulkRequest({ action: 'update', ids: [id], patch: { addTagIds: ['t9', 't10'] } }))
      expect((await readDoc(db, `organizations/${ORG}/transactions/${id}`))?.tags).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}`))
    })
  })
})
