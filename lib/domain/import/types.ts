/** Largest statement file accepted (bytes of the request text). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024
/** Most operations one file may bring; over it the preview answers 422 `too_many_operations`. */
export const MAX_IMPORT_OPS = 5000
/** Operations a write step takes (same as the S09 sync step). */
export const IMPORT_STEP = 25

/** One booked line of a statement, before its ordinal is known. */
export interface RawOp {
  /** Booking day (the entry date when the line has one, else the value day), YYYY-MM-DD. */
  day: string
  type: 'income' | 'expense'
  /** Always >= 0; a zero amount is refused later (`judgeOp`). */
  amountMinor: number
  /** The bank's reference (`//ref` of :61:), else the customer reference unless it is NONREF; null when the file has none. */
  reference: string | null
  counterpartyName: string | null
  remittance: string | null
}

/** A line of a statement; `ordinal` separates identical lines of one statement (two equal coffees on one day). */
export interface ImportOp extends RawOp {
  ordinal: number
}

/** A signed balance of the statement: positive for C, negative for D. */
export interface StatementBalance {
  amountMinor: number
  day: string
  currency: string
}

export interface ParsedStatement {
  /** Position of the statement in the file (0-based). */
  index: number
  /** `:25:` as the file gives it, normalized by `normalizeSource` (an IBAN when it is one); null when absent. */
  source: string | null
  /** `:28C:` */
  number: string | null
  currency: string | null
  opening: StatementBalance | null
  closing: StatementBalance | null
  operations: ImportOp[]
  /** `opening + Σ signed operations − closing`; null when a balance is missing. 0 means the statement adds up. */
  reconciliation: number | null
  /** The issues of the lines of this statement (the file's issues, in order, are `ParseResult.issues`). */
  issues: LineIssue[]
}

export type ParseIssueCode = 'no_statement' | 'bad_61' | 'bad_balance' | 'orphan_86'
export interface ParseIssue {
  code: ParseIssueCode
  /** 1-based line of the tag in the file. */
  line: number
  tag?: string
}

/** An issue of a statement's lines: every code but `no_statement`, which is about the file as a whole. */
export type LineIssueCode = Exclude<ParseIssueCode, 'no_statement'>
export interface LineIssue extends ParseIssue {
  code: LineIssueCode
}

/** Partial facts are kept: statements that parsed are returned even when other lines gave issues. */
export interface ParseResult {
  statements: ParsedStatement[]
  issues: ParseIssue[]
}

export type RefusalReason = 'date' | 'future_date' | 'currency_mismatch' | 'amount'
export type OpStatus = 'new' | 'seen' | 'bank' | `refused:${RefusalReason}`
