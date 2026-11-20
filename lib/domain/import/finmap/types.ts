export const MAX_FINMAP_BYTES = 100 * 1024 * 1024
export const MAX_FINMAP_ROWS = 100_000
/** Operations a batch request carries. */
export const FINMAP_BATCH_OPS = 60
/** Writes one Firestore transaction may hold (the limit is 500). */
export const WRITE_BUDGET = 450
/** Finmap's built-in "no category" names (the Polish export). Matched after `normKey`. */
export const NO_CATEGORY_NAMES = ['kategorie dochodów', 'kategorie wydatków'] as const

export type ColumnKey =
  | 'paymentDate' | 'bookingDate' | 'periodFrom' | 'periodTo' | 'amountAccount' | 'amountCompany'
  | 'from' | 'to' | 'category' | 'subcategory' | 'counterparty' | 'subcounterparty' | 'project' | 'subproject' | 'tags' | 'comment'

/** One data row of the export. Names are whitespace-normalised, never folded. */
export interface FinmapRow {
  /** 1-based row number in the sheet (the header is row 1). */
  line: number
  /** YYYY-MM-DD, or null when the cell is not a date. */
  paymentDay: string | null
  /** The payment date cell exactly as the file has it (an Excel serial with a time, or text): part of the key, never shown. */
  timeText: string
  /** Minutes since midnight of the payment time (0 when the cell has no time). */
  minute: number
  /** «Kwota w walucie konta» in minor units; null when not a number with at most 2 decimals. */
  amountMinor: number | null
  from: string | null
  to: string | null
  category: string | null
  subcategory: string | null
  counterparty: string | null
  hasSubcounterparty: boolean
  hasProject: boolean
  tags: string[]
  comment: string | null
  /** Period «od» and «do» as days; null when either is missing or unreadable. */
  period: { from: string; to: string } | null
}

export type TableIssueCode = 'unknown_layout' | 'empty' | 'too_many_rows'
export interface TableIssue {
  code: TableIssueCode
  /** For `unknown_layout`: the column keys that were not found. */
  missing?: ColumnKey[]
}
