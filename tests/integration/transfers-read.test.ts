import { beforeEach, describe, expect, it } from 'vitest'
import { addDays } from '@/lib/domain/ledger/days'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { SUGGEST_SCAN } from '@/lib/domain/transfers/types'
import { makeTransfer, type TransferJob } from '@/lib/server/ledger/transfer'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { readTransferSuggestions } from '@/lib/server/transfers/read'
import { runTransfers } from '@/lib/server/transfers/run'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedOrg, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const ledger = { makeTransfer: (orgId: string, uid: string, job: TransferJob) => makeTransfer(deps, orgId, uid, job) }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 0)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
})

describe('readTransferSuggestions', () => {
  it('offers a bank pair of the last 90 days with the versions to confirm it, and leaves out manual and older operations', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 50_000, paymentDate: '2026-10-25' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 50_000, paymentDate: '2026-10-26' })
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'cash', amountMinor: 50_000, paymentDate: '2026-10-25' }))
    // 2026-07-01 is before the 90 days that end on TODAY (2026-10-27).
    await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 7_000, paymentDate: '2026-07-01' })
    await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mono', amountMinor: 7_000, paymentDate: '2026-07-01' })

    const read = await readTransferSuggestions(deps, ORG)
    expect(read).toMatchObject({ total: 1, ambiguous: 0, truncated: false, scanned: 3, bankSides: 2 })
    expect(read.pairs).toEqual([
      {
        from: expect.objectContaining({ id: out.id, accountId: 'mil', amountMinor: 50_000, paymentDate: '2026-10-25', remittance: out.bank?.remittance }),
        to: expect.objectContaining({ id: inc.id, accountId: 'mono', paymentDate: '2026-10-26' }),
      },
    ])

    const [pair] = read.pairs
    const results = await runTransfers(ledger, ORG, UID, { kind: 'pairs', pairs: [{ ids: [pair.from.id, pair.to.id], versions: [pair.from.version, pair.to.version] }] })
    expect(results).toMatchObject([{ ok: true, id: out.id, deletedId: inc.id, droppedTags: 0 }])
    expect((await readTransferSuggestions(deps, ORG)).total).toBe(0)
  })

  it('a pair changed after the read is a conflict; the next read offers it with the new version', async () => {
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 50_000, paymentDate: '2026-10-25' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 50_000, paymentDate: '2026-10-25' })
    const [stale] = (await readTransferSuggestions(deps, ORG)).pairs
    await updateTransaction(deps, ORG, UID, inc.id, { description: 'Zmieniony' })
    const request = (p: typeof stale) => ({ kind: 'pairs' as const, pairs: [{ ids: [p.from.id, p.to.id] as [string, string], versions: [p.from.version, p.to.version] as [string, string] }] })
    expect(await runTransfers(ledger, ORG, UID, request(stale))).toEqual([{ ids: [stale.from.id, stale.to.id], ok: false, code: 'conflict' }])
    const [fresh] = (await readTransferSuggestions(deps, ORG)).pairs
    expect(fresh.to.version).not.toBe(stale.to.version)
    expect((await runTransfers(ledger, ORG, UID, request(fresh)))[0].ok).toBe(true)
  })

  it('a side with two candidates is not offered and counts as ambiguous', async () => {
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 70_000, paymentDate: '2026-10-20' })
    await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 70_000, paymentDate: '2026-10-20' })
    await importBankOp(db, deps, { key: KEY(3), type: 'income', accountId: 'cash', amountMinor: 70_000, paymentDate: '2026-10-21' })
    expect(await readTransferSuggestions(deps, ORG)).toMatchObject({ pairs: [], total: 0, ambiguous: 1 })
  })

  it('planned operations later than today do not fill the scan and hide a real pair', async () => {
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 50_000, paymentDate: '2026-10-25' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 50_000, paymentDate: '2026-10-26' })
    // More planned operations than one read scans, all after today: with no upper bound they are the newest and take the whole scan.
    const planned = db.collection(`organizations/${ORG}/transactions`)
    for (let start = 0; start <= SUGGEST_SCAN; start += 500) {
      const batch = db.batch()
      for (let i = start; i <= Math.min(start + 499, SUGGEST_SCAN); i++) {
        batch.set(planned.doc(`plan-${i}`), {
          type: 'expense',
          status: 'planned',
          accountId: 'mil',
          currency: 'PLN',
          amountMinor: 1_000,
          paymentDate: addDays(deps.today(), 1 + (i % 3000)),
        })
      }
      await batch.commit()
    }

    const read = await readTransferSuggestions(deps, ORG)
    expect(read).toMatchObject({ total: 1, truncated: false, scanned: 2 })
    expect(read.pairs.map((p) => p.to.id)).toEqual([inc.id])
  })
})
