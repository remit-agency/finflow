export type LedgerErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'account_not_found'
  | 'category_not_found'
  | 'counterparty_not_found'
  | 'counterparty_archived'
  | 'currency_mismatch'
  | 'future_actual'
  | 'account_has_operations'
  | 'account_linked_to_bank'
  | 'currency_locked'
  | 'ledger_busy'
  | 'conflict'
  | 'bank_locked'
  | 'tag_not_found'
  | 'tag_archived'
  /** The operations cannot become a transfer, or the transfer cannot be split (S10b). */
  | 'not_eligible'
  /** A planned occurrence of a series cannot become a transfer (S11, C2). */
  | 'series_transfer'

/** An expected failure of a ledger operation. `field` names the offending input field, if any. */
export class LedgerError extends Error {
  public readonly code: LedgerErrorCode
  public readonly field?: string

  constructor(code: LedgerErrorCode, field?: string) {
    super(field === undefined ? code : `${code}:${field}`)
    this.name = 'LedgerError'
    this.code = code
    this.field = field
  }
}
