import type { TransactionDraft } from '@/lib/api/ledger-client'
import type { Transaction } from '@/types'

/** What the transaction form edits itself: everything in a draft except the fields it has no control for. */
export type FormOwnedDraft = Omit<TransactionDraft, 'accrual' | 'counterpartyId' | 'projectId' | 'tags' | 'fileUrls'>

/** The `YYYY-MM-DD` UTC day of a stored payment date. */
function paymentDay(date: Date): string {
  return date.toISOString().split('T')[0]
}

/** A draft for a new operation: it has no tags, files, counterparty, project or own accrual yet. */
export function buildCreateDraft(form: FormOwnedDraft): TransactionDraft {
  return { ...form, tags: [], fileUrls: [] }
}

/**
 * A draft for saving an edited operation. The edit is sent as a full replace (absent optional
 * fields are cleared), so every field the form has no control for must be carried over from the
 * stored operation, or an edit of the amount alone would erase them: counterparty, project, tags,
 * files and the accrual period. Fields the form owns (category, description, transfer fields) are
 * taken from the form as they are, so the user can still clear them.
 *
 * The accrual is kept unless it merely followed the payment date (mode `date`, equal to the stored
 * payment date): then none is sent and the server makes it follow the new payment date, as
 * `toRawInput` does there. A transfer has neither accrual nor counterparty, and the server refuses
 * both, so nothing is carried for them when the form saves a transfer.
 */
export function buildEditDraft(transaction: Transaction, form: FormOwnedDraft): TransactionDraft {
  const draft: TransactionDraft = {
    ...form,
    tags: [...transaction.tags],
    fileUrls: [...transaction.fileUrls],
  }
  if (transaction.projectId !== undefined) draft.projectId = transaction.projectId
  if (form.type !== 'transfer') {
    if (transaction.counterpartyId !== undefined) draft.counterpartyId = transaction.counterpartyId
    const { accrual } = transaction
    const followedPaymentDate = accrual.mode === 'date' && accrual.date === paymentDay(transaction.date)
    if (!followedPaymentDate) draft.accrual = accrual
  }
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
