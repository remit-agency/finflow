import { createTransaction, updateTransaction, type BankRestore } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import type { Transaction } from '@/types'

/** Undo of a delete: the operation is created again under its own id, with the content it had (and its bank sides, S10b). */
export function restoreTransaction(orgId: string, tx: Transaction): Promise<string> {
  return createTransaction(orgId, transactionToDraft(tx), tx.id, bankRestoreOf(tx))
}

/**
 * What the undo of a deleted bank transfer adds to its draft (S10b): the arrival day when it differs from the payment day,
 * and the key of the incoming bank side when both sides came from banks (a transfer with one bank side is under that side's
 * own id). Nothing for any other operation. The server takes the bank blocks from its marks, never from here.
 */
export function bankRestoreOf(tx: Transaction): BankRestore {
  if (tx.type !== 'transfer') return {}
  const out: BankRestore = {}
  if (tx.toDate !== undefined) out.toDate = tx.toDate
  if (tx.bank !== undefined && tx.bankTo !== undefined) out.bankToKey = tx.bankTo.key
  return out
}

/**
 * Undo of an edit or of a bulk change: the operation as it was stored before is written back as a full replace. It says so
 * (`restore`), because the state may carry a tag that is archived by now.
 * The series flags (`manual`, `estimated`, S11) are not part of the draft and are not restored: they are the server's, and
 * the request may not set them. An undo of a manual change of a planned occurrence therefore keeps `manual` (the series no
 * longer rewrites it) and leaves `estimated` off. Restoring them exactly would need the pre-edit flags on the server
 * (PROGRESS.md, S11 follow-ups).
 */
export function revertTransaction(orgId: string, before: Transaction): Promise<void> {
  return updateTransaction(orgId, before.id, transactionToDraft(before), { restore: true })
}
