import type { BankInfo, LedgerTransaction, TxStatus, TxType } from '@/lib/domain/ledger/types'

/** How far back the suggestions look (S10b): the payment days of the last 90 days. */
export const SUGGEST_DAYS = 90
/** Operations one suggestions read takes at most, newest first; beyond it the answer says `truncated`. */
export const SUGGEST_SCAN = 2000
/** Pairs one answer offers at most, newest first. */
export const MAX_SUGGESTIONS = 50
/** The two sides of a suggested pair are at most this many days apart (a manual merge allows MAX_ARRIVAL_DAYS). */
export const SUGGEST_MAX_DAYS = 3
/** Operations one «Зробити переказом» request converts at most; the browser sends a larger selection in several. */
export const MAX_CONVERT_IDS = 25
/** The largest JSON body of `POST /transfers`. */
export const TRANSFER_BODY_MAX_BYTES = 64 * 1024

/** One operation as the suggestions read sees it: only the fields it selects, and the document's version. */
export interface Candidate {
  id: string
  version: string
  type: TxType
  status: TxStatus
  isRecurring: boolean
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  bank?: BankInfo
  /** Set when the operation paid a planned occurrence (S11): then it is no side of a transfer. */
  seriesId?: string
}

/** One side of a suggested pair: what the dialog shows, and the version the confirmation sends back. */
export interface SuggestionSide {
  id: string
  version: string
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  counterpartyName?: string
  remittance?: string
}

/** A suggested own transfer: the bank expense (`from`) and the bank income (`to`). */
export interface TransferSuggestion {
  from: SuggestionSide
  to: SuggestionSide
}

export interface SuggestionsResult {
  /** At most MAX_SUGGESTIONS, newest first. */
  pairs: TransferSuggestion[]
  /** Unambiguous pairs found, before the cap. */
  total: number
  /** Bank sides with more than one candidate: not offered, left to the person. */
  ambiguous: number
  /** The read stopped at SUGGEST_SCAN operations: older ones were not looked at. */
  truncated: boolean
}

/** A parsed body of `POST /transfers`. */
export type TransferRequest =
  | { kind: 'pairs'; pairs: { ids: [string, string]; versions: [string, string] }[] }
  | { kind: 'merge'; ids: [string, string] }
  | { kind: 'convert'; ids: string[]; toAccountId: string }

/** The result of one pair or one operation of a request. */
export type TransferOutcome =
  | { ids: string[]; ok: true; id: string; deletedId: string | null; droppedTags: number; before: LedgerTransaction[] }
  | { ids: string[]; ok: false; code: string }

export type MadeOutcome = Extract<TransferOutcome, { ok: true }>
export type FailedOutcome = Extract<TransferOutcome, { ok: false }>
