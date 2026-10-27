import 'server-only'
import { toDay } from '@/lib/domain/ledger/days'
import type { AccountInput, AccountPatch, OrgPatch } from '@/lib/domain/ledger/entity-input'
import type { TransactionInput, TransactionPatch } from '@/lib/domain/ledger/input'
import { getAdmin } from '@/lib/server/firebase-admin'
import { resolveRate } from '@/lib/server/fx'
import { todayUtcDay } from '@/lib/utils/today'
import { createAccount, deleteAccount, updateAccount } from './accounts'
import type { LedgerDeps } from './deps'
import { updateOrganization } from './org'
import { rebuildLedger } from './rebuild'
import { createTransaction, deleteTransaction, updateTransaction } from './write'

export type { LedgerReport } from './verify'

function deps(): LedgerDeps {
  return { db: getAdmin().db, resolveRate, now: () => new Date(), today: () => toDay(todayUtcDay()) }
}

/** The ledger bound to the production Firestore, NBP rates and the Warsaw clock. */
export const ledger = {
  createTransaction: (orgId: string, uid: string, input: TransactionInput) => createTransaction(deps(), orgId, uid, input),
  updateTransaction: (orgId: string, uid: string, txId: string, patch: TransactionPatch) => updateTransaction(deps(), orgId, uid, txId, patch),
  deleteTransaction: (orgId: string, uid: string, txId: string) => deleteTransaction(deps(), orgId, uid, txId),
  createAccount: (orgId: string, uid: string, input: AccountInput) => createAccount(deps(), orgId, uid, input),
  updateAccount: (orgId: string, uid: string, accountId: string, patch: AccountPatch) => updateAccount(deps(), orgId, uid, accountId, patch),
  deleteAccount: (orgId: string, uid: string, accountId: string) => deleteAccount(deps(), orgId, uid, accountId),
  updateOrganization: (orgId: string, uid: string, patch: OrgPatch) => updateOrganization(deps(), orgId, uid, patch),
  rebuild: (orgId: string, uid: string, apply: boolean) => rebuildLedger(deps(), orgId, uid, { apply }),
}
