import type { TransactionDraft } from '@/lib/api/ledger-client'
import { accrualFor } from '@/lib/domain/transaction-form/accrual'
import type { FormState } from '@/lib/domain/transaction-form/state'
import { effectiveStatus } from '@/lib/domain/transaction-form/status'
import { parseAmountInput } from '@/lib/utils/amount-input'
import type { Transaction } from '@/types'

/** What the transaction form edits itself: everything in a draft except what it has no control for (project, files). */
export type FormOwnedDraft = Omit<TransactionDraft, 'projectId' | 'fileUrls'>

/** The `YYYY-MM-DD` UTC day of a stored payment date. */
function paymentDay(date: Date): string {
  return date.toISOString().split('T')[0]
}

/** The draft the form sends for what is typed. `validateState` has already refused anything unparseable. */
export function stateToDraft(state: FormState, o: { today: string; crossCurrency: boolean }): FormOwnedDraft {
  const draft: FormOwnedDraft = {
    type: state.type,
    status: effectiveStatus(state.status, state.paymentDate, o.today),
    accountId: state.accountId,
    amount: parseAmountInput(state.amount) ?? 0,
    paymentDate: state.paymentDate,
    isRecurring: state.isRecurring,
    tags: [...state.tagIds],
  }
  if (state.type === 'transfer') {
    draft.toAccountId = state.toAccountId
    if (o.crossCurrency) draft.toAmount = parseAmountInput(state.toAmount) ?? 0
  } else {
    if (state.categoryId) draft.categoryId = state.categoryId
    if (state.counterpartyId) draft.counterpartyId = state.counterpartyId
    const accrual = accrualFor(state.accrual, state.paymentDate)
    if (accrual) draft.accrual = accrual
  }
  const description = state.description.trim()
  if (description) draft.description = description
  return draft
}

/** A draft for a new operation: it has the tags the form chose, and no files or project yet. */
export function buildCreateDraft(form: FormOwnedDraft): TransactionDraft {
  return { ...form, fileUrls: [] }
}

/**
 * A draft for saving an edited operation. The edit is sent as a full replace (absent optional fields are
 * cleared), so the two fields the form has no control for must be carried over from the stored operation,
 * or an edit of the amount alone would erase them: project and files. Everything else (category, counterparty,
 * accrual, status, description, tags since S10t) comes from the form, so the person can still change or clear it.
 */
export function buildEditDraft(transaction: Transaction, form: FormOwnedDraft): TransactionDraft {
  const draft: TransactionDraft = {
    ...form,
    fileUrls: [...transaction.fileUrls],
  }
  if (transaction.projectId !== undefined) draft.projectId = transaction.projectId
  return draft
}

/**
 * The full draft of a stored operation: what a create (restoring a deleted operation) or a full replace
 * (undoing an edit) needs to give the same operation back. An accrual that merely followed the payment date
 * is left out so it follows again. A transfer has neither accrual nor counterparty (the server refuses both),
 * and its second amount only matters across currencies.
 */
export function transactionToDraft(tx: Transaction): TransactionDraft {
  const draft: TransactionDraft = {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    amount: tx.amount,
    paymentDate: paymentDay(tx.date),
    isRecurring: tx.isRecurring,
    tags: [...tx.tags],
    fileUrls: [...tx.fileUrls],
  }
  if (tx.description !== undefined) draft.description = tx.description
  if (tx.projectId !== undefined) draft.projectId = tx.projectId
  if (tx.type === 'transfer') {
    if (tx.toAccountId !== undefined) draft.toAccountId = tx.toAccountId
    if (tx.toAmount !== undefined && tx.toCurrency !== undefined && tx.toCurrency !== tx.currency) draft.toAmount = tx.toAmount
    return draft
  }
  if (tx.categoryId !== undefined) draft.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) draft.counterpartyId = tx.counterpartyId
  const followedPaymentDate = tx.accrual.mode === 'date' && tx.accrual.date === paymentDay(tx.date)
  if (!followedPaymentDate) draft.accrual = tx.accrual
  return draft
}

/** The category after the user picks another type tab: a category belongs to one type, so it is cleared on a real change only. */
export function categoryAfterTypeChange(
  categoryId: string,
  from: Transaction['type'],
  to: Transaction['type'],
): string {
  return from === to ? categoryId : ''
}
