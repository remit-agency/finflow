import { createTransaction, updateTransaction } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import type { Transaction } from '@/types'

/** Undo of a delete: the operation is created again under its own id, with the content it had. */
export function restoreTransaction(orgId: string, tx: Transaction): Promise<string> {
  return createTransaction(orgId, transactionToDraft(tx), tx.id)
}

/**
 * Undo of an edit or of a bulk change: the operation as it was stored before is written back as a full replace. It says so
 * (`restore`), because the state may carry a tag that is archived by now.
 */
export function revertTransaction(orgId: string, before: Transaction): Promise<void> {
  return updateTransaction(orgId, before.id, transactionToDraft(before), { restore: true })
}
