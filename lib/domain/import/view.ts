import type { ImportOp, LineIssue, OpStatus, ParseIssue, RefusalReason, StatementBalance } from './types'

/** The shapes the import API returns (S14). Pure types: the browser client and the server both import them. */

export type ImportStatus = 'applied' | 'undoing' | 'undone'

/** `mt940`: a bank statement file (S14). `finmap`: a Finmap «Płatności» export (S14b). A document without a kind is `mt940`. */
export type ImportKind = 'mt940' | 'finmap'

/** An applied import can be undone; an undo that stopped part way (`undoing`) is undone again: it resumes from the start. */
export function canUndo(status: ImportStatus): boolean {
  return status === 'applied' || status === 'undoing'
}

export interface ImportPeriod {
  from: string | null
  to: string | null
}

export interface ImportCounts {
  created: number
  skipped: number
  refused: number
}

export interface ImportUndoCounts {
  deleted: number
  kept: number
}

/** One statement written by an import: its source (`:25:`), the account it went to and its period. */
export interface ImportStatementRef {
  source: string | null
  accountId: string
  from: string | null
  to: string | null
}

export interface ImportView {
  id: string
  kind: ImportKind
  fileName: string
  createdAt: string
  accountIds: string[]
  period: ImportPeriod
  counts: ImportCounts
  statements: ImportStatementRef[]
  status: ImportStatus
  undoneAt?: string
  undo: ImportUndoCounts
}

/** The answer of one write step (at most 25 operations). */
export interface ImportStepResult {
  importId: string
  created: number
  /** Lines already in the account: marked by an earlier import (`seen`), or the same operation a bank sync wrote (`bank`). */
  skipped: { seen: number; bank: number }
  refused: Array<{ day: string; amountMinor: number; reason: RefusalReason }>
  /** True on the last step of a statement. */
  done: boolean
  /** Set on the last step: the account balance, the statement's closing balance and their difference (balance − closing). */
  balanceMinor: number | null
  closingMinor: number | null
  differenceMinor: number | null
  fitted: boolean
}

export interface PreviewStatement {
  index: number
  /** `:25:` normalized (an IBAN when it is one); null when the file has none. */
  source: string | null
  number: string | null
  currency: string | null
  opening: StatementBalance | null
  closing: StatementBalance | null
  /** Day of the first and of the last operation; null when the statement has none. */
  from: string | null
  to: string | null
  reconciliation: number | null
  /** The parse issues of this statement's lines (the file's are on `PreviewResult`). */
  issues: LineIssue[]
  /** The account this statement most likely belongs to (its source seen in an import or an active bank account); null when unknown. */
  suggestedAccountId: string | null
  /** Present when the caller chose an account for this statement. */
  chosen?: { accountId: string; accountCurrency: string; balanceMinor: number; counts: { new: number; seen: number; bank: number; refused: number } }
  /** With a chosen account every operation has its status; without one none does. */
  operations: Array<ImportOp & { status?: OpStatus }>
}

export interface PreviewResult {
  statements: PreviewStatement[]
  issues: ParseIssue[]
  opCount: number
}

/** The answer of one undo step: at most 25 operations removed. */
export interface UndoResult {
  deleted: number
  /** The operations left in place, with why: `changed` (a person changed them after the import) or the ledger's refusal code. */
  kept: Array<{ id: string; reason: string }>
  /** The id to pass as the cursor of the next step; null on the last one. */
  next: string | null
  done: boolean
}
