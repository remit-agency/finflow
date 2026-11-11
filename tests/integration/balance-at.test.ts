import { beforeEach, describe, expect, it } from 'vitest'
import { parseAccount } from '@/lib/domain/ledger/doc'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { LedgerAccount } from '@/lib/domain/ledger/types'
import { balancesAt, type BalanceReadStats } from '@/lib/server/ledger/balance-at'
import { accountsCol } from '@/lib/server/ledger/paths'
import { readSnapshot } from '@/lib/server/ledger/reader'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, TODAY, UID, clearFirestore, makeDeps, seedAccount, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function accounts(): Promise<LedgerAccount[]> {
  return (await accountsCol(db, ORG).get()).docs.map((d) => parseAccount(d.id, d.data())).filter((a): a is LedgerAccount => a !== null)
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'bank', 'PLN', 100_000)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
  const create = (body: Record<string, unknown>) => createTransaction(deps, ORG, UID, parseTransactionInput(body))
  await create({ type: 'income', accountId: 'bank', amountMinor: 50_000, paymentDate: '2026-10-05' })
  await create({ type: 'expense', accountId: 'bank', amountMinor: 12_000, paymentDate: '2026-10-06' })
  await create({ type: 'transfer', accountId: 'bank', toAccountId: 'cash', amountMinor: 30_000, paymentDate: '2026-10-20' })
  await create({ type: 'expense', status: 'planned', accountId: 'bank', amountMinor: 7_000, paymentDate: '2026-10-30' })
})

describe('balancesAt (shared by the journal and the reports)', () => {
  it('the account minus what moved it later; today and later are the account itself; a planned operation moves nothing', async () => {
    const stats: BalanceReadStats = { docsRead: 0, aggregates: 0 }
    const list = await accounts()
    const days = ['2026-10-04', '2026-10-05', '2026-10-19', '2026-10-20', TODAY, '2026-12-31']
    const result = await readSnapshot(db, (reader) => balancesAt(reader, deps, ORG, list, days, TODAY, stats))
    expect(Object.fromEntries(result.get('bank') ?? [])).toEqual({
      '2026-10-04': 100_000, '2026-10-05': 150_000, '2026-10-19': 138_000, '2026-10-20': 108_000, [TODAY]: 108_000, '2026-12-31': 108_000,
    })
    expect(Object.fromEntries(result.get('cash') ?? [])).toEqual({
      '2026-10-04': 0, '2026-10-05': 0, '2026-10-19': 0, '2026-10-20': 30_000, [TODAY]: 30_000, '2026-12-31': 30_000,
    })
    // Three sum aggregates per account and past day; the history before a day is never read.
    expect(stats.aggregates).toBe(3 * 2 * 4)
  })
})
