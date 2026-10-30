import 'server-only'
import { toDay } from '@/lib/domain/ledger/days'
import type { AccountInput, AccountPatch, OrgPatch } from '@/lib/domain/ledger/entity-input'
import type { TransactionInput, TransactionPatch } from '@/lib/domain/ledger/input'
import type { TagChange } from '@/lib/domain/tags/assign'
import { getAdmin } from '@/lib/server/firebase-admin'
import { resolveRate } from '@/lib/server/fx'
import { todayUtcDay } from '@/lib/utils/today'
import { createAccount, deleteAccount, updateAccount } from './accounts'
import type { LedgerDeps } from './deps'
import { updateOrganization } from './org'
import { rebuildLedger } from './rebuild'
import { createTransaction, deleteTransaction, retagTransaction, updateTransaction, type WriteExtras } from './write'

export type { LedgerReport } from './verify'

/** The production dependencies of the ledger: Admin Firestore, NBP rates, the Warsaw clock. Shared with S09. */
export function ledgerDeps(): LedgerDeps {
  return { db: getAdmin().db, resolveRate, now: () => new Date(), today: () => toDay(todayUtcDay()) }
}

/** The ledger bound to the production Firestore, NBP rates and the Warsaw clock. */
export const ledger = {
  createTransaction: (orgId: string, uid: string, input: TransactionInput) => createTransaction(ledgerDeps(), orgId, uid, input),
  updateTransaction: (orgId: string, uid: string, txId: string, patch: TransactionPatch, extras: Pick<WriteExtras, 'restore'> = {}) =>
    updateTransaction(ledgerDeps(), orgId, uid, txId, patch, extras),
  deleteTransaction: (orgId: string, uid: string, txId: string) => deleteTransaction(ledgerDeps(), orgId, uid, txId),
  retagTransaction: (orgId: string, uid: string, txId: string, change: TagChange) => retagTransaction(ledgerDeps(), orgId, uid, txId, change),
  createAccount: (orgId: string, uid: string, input: AccountInput) => createAccount(ledgerDeps(), orgId, uid, input),
  updateAccount: (orgId: string, uid: string, accountId: string, patch: AccountPatch) => updateAccount(ledgerDeps(), orgId, uid, accountId, patch),
  deleteAccount: (orgId: string, uid: string, accountId: string) => deleteAccount(ledgerDeps(), orgId, uid, accountId),
  updateOrganization: (orgId: string, uid: string, patch: OrgPatch) => updateOrganization(ledgerDeps(), orgId, uid, patch),
  rebuild: (orgId: string, uid: string, apply: boolean) => rebuildLedger(ledgerDeps(), orgId, uid, { apply }),
}
