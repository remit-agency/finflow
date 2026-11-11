// The company of the S12 integration tests, written through the ledger so the rollups are real.
import type { Firestore } from 'firebase-admin/firestore'
import { addDays } from '@/lib/domain/ledger/days'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { RateSnapshot } from '@/lib/server/fx/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, TODAY, UID, clearFirestore, seedAccount, seedCategory, seedOrg, seedTag } from './helpers'

/** EUR in PLN: 4.00 asked up to 2026-10-01, 4.20 up to 2026-10-15, 4.40 after; identity for one currency. */
export const steppedRate: LedgerDeps['resolveRate'] = async (from, to, date): Promise<RateSnapshot> => {
  const same = from === to
  const rate = same ? 1 : date <= '2026-10-01' ? 4 : date <= '2026-10-15' ? 4.2 : 4.4
  return {
    rate, from, to, requestedDate: date, rateDate: same ? date : addDays(date, -1), tableNo: same ? null : `T/${date}`,
    source: same ? 'identity' : 'NBP_A', final: date <= TODAY,
  }
}

/**
 * «pln» from 1000 zł and «eur» from 100 €; in October a sale of 500 (k-in), an expense of 120 (k-ex), VAT of 230 tagged
 * «ПДВ» (excluded from analytics), 50 € in on «eur» (210 zł at 4.20, k-in), a transfer of 430 zł for 100 € on the 20th and a
 * planned expense of 70 zł on the 30th. Today is 2026-10-27.
 */
export async function seedReportCompany(db: Firestore, deps: LedgerDeps): Promise<void> {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'pln', 'PLN', 100_000)
  await seedAccount(db, ORG, 'eur', 'EUR', 10_000)
  await seedCategory(db, ORG, 'k-in', 'income')
  await seedCategory(db, ORG, 'k-ex', 'expense')
  await seedTag(db, ORG, 'vat', { name: 'ПДВ', excludeFromAnalytics: true })
  const create = (body: Record<string, unknown>) => createTransaction(deps, ORG, UID, parseTransactionInput(body))
  await create({ type: 'income', accountId: 'pln', amountMinor: 50_000, paymentDate: '2026-10-05', categoryId: 'k-in' })
  await create({ type: 'expense', accountId: 'pln', amountMinor: 12_000, paymentDate: '2026-10-06', categoryId: 'k-ex' })
  await create({ type: 'expense', accountId: 'pln', amountMinor: 23_000, paymentDate: '2026-10-07', tags: ['vat'] })
  await create({ type: 'income', accountId: 'eur', amountMinor: 5_000, paymentDate: '2026-10-10', categoryId: 'k-in' })
  await create({ type: 'transfer', accountId: 'pln', toAccountId: 'eur', amountMinor: 43_000, toAmountMinor: 10_000, paymentDate: '2026-10-20' })
  await create({ type: 'expense', status: 'planned', accountId: 'pln', amountMinor: 7_000, paymentDate: '2026-10-30' })
}
