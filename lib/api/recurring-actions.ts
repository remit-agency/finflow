import { paidDay } from '@/lib/domain/transaction-form/status'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import type { Transaction } from '@/types'
import { fetchTransaction } from './journal-client'
import { updateTransaction } from './ledger-client'
import { notifyRecurringChanged, skipPlan } from './recurring-client'
import { transactionToDraft } from './transaction-draft'
import { restoreTransaction, revertTransaction } from './transaction-undo'

/**
 * «Позначити сплаченою» from the page (S11): the operation as it is now (the list can be stale) becomes actual on its day,
 * or today when that is still ahead, as the form does. Returns it as it was, for the undo.
 */
export async function markPlanPaid(orgId: string, txId: string, today: string): Promise<Transaction> {
  const before = toUiTransaction(orgId, await fetchTransaction(orgId, txId))
  const draft = transactionToDraft(before)
  await updateTransaction(orgId, txId, { ...draft, status: 'actual', paymentDate: paidDay(draft.paymentDate, today) })
  notifyRecurringChanged()
  return before
}

/** «Перенести»: a new payment day (the ledger then marks the occurrence «змінено вручну»). Returns it as it was. */
export async function movePlan(orgId: string, txId: string, paymentDate: string): Promise<Transaction> {
  const before = toUiTransaction(orgId, await fetchTransaction(orgId, txId))
  await updateTransaction(orgId, txId, { ...transactionToDraft(before), paymentDate })
  notifyRecurringChanged()
  return before
}

/** «Пропустити»: the plan as it was, for the undo. */
export async function skipPlanOccurrence(orgId: string, seriesId: string, occurrence: string): Promise<Transaction> {
  return toUiTransaction(orgId, await skipPlan(orgId, seriesId, occurrence))
}

/** The undo of «Позначити сплаченою» or «Перенести»: the operation written back as it was (the mark follows it). */
export async function undoPlanEdit(orgId: string, before: Transaction): Promise<void> {
  await revertTransaction(orgId, before)
  notifyRecurringChanged()
}

/** The undo of «Пропустити»: the plan re-created under its plan id from its `skipped` mark. */
export async function undoPlanSkip(orgId: string, before: Transaction): Promise<void> {
  await restoreTransaction(orgId, before)
  notifyRecurringChanged()
}
