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

/** `name`: a name the row would write (account, category, subcategory, counterparty or tag) is over its cap or has no letter or digit. */
export type FinmapRefusal = 'date' | 'amount' | 'account' | 'name' | 'planned_off' | 'accrual_after_horizon'
export type OpKind = 'income' | 'expense' | 'transfer'

/** What the import knows of FinFlow before it starts (names only; ids come back from the setup step). */
export interface FinmapExisting {
  companyCurrency: string
  accounts: Array<{ id: string; name: string; currency: string }>
  categories: Array<{ id: string; name: string; type: 'income' | 'expense'; parentId?: string }>
  /** `archived`: the setup matches an archived item too, but the batch refuses the operations that use it (not un-archived). */
  counterparties: Array<{ id: string; name: string; archived?: boolean }>
  tags: Array<{ id: string; name: string; archived?: boolean }>
}
export interface FinmapOptions {
  /** Rows dated after `today` become planned operations when true, and are left out when false. */
  includePlanned: boolean
  pairTransfers: boolean
  /** The Warsaw day. */
  today: string
  /** Currency of accounts that do not exist yet, keyed by `normKey` of the account name. Default: the company currency. */
  newAccountCurrency?: Record<string, string>
}

/** A category reference by names; `child` is the subcategory name. */
export interface CategoryRef {
  type: 'income' | 'expense'
  parent: string
  child: string | null
}

/** One operation the import will write, by names (the client resolves ids after the setup step). */
export interface PlannedOp {
  kind: OpKind
  status: 'actual' | 'planned'
  day: string
  amountMinor: number
  /** Account names: `account` is the source (the expense side or the transfer's source), `toAccount` the target. */
  account: string
  toAccount: string | null
  /** The amount that arrives (transfers between accounts of different currencies); null otherwise. */
  toAmountMinor: number | null
  category: CategoryRef | null
  counterparty: string | null
  tags: string[]
  description: string | null
  accrual: { from: string; to: string } | null
  /** The strings that identify the operation in its key besides the account ids and the ordinal. */
  identity: string[]
  ordinal: number
  /** The sheet lines it came from (one, or two for a transfer): for messages only. */
  lines: number[]
}

export interface FinmapCounts {
  rows: number
  income: number
  expense: number
  transfer: number
  planned: number
  /**
   * Pairs not made only because a side has a real category or a counterparty: groups of exactly one expense and one income
   * on different accounts with the same currency. 0 when pairing is off.
   */
  pairCandidatesLeft: number
  refused: Partial<Record<FinmapRefusal, number>>
  /** Warnings that do not stop a row. */
  warnings: { commentCut: number; subcounterparty: number; project: number; accrualIgnored: number; categoryIgnored: number; archivedMatched: number }
}

export interface FinmapPlan {
  operations: PlannedOp[]
  /** The first and last day of the operations; null when there are none. */
  period: { from: string; to: string } | null
  /** What does not exist in FinFlow yet (by normalised name; categories parents first). */
  create: {
    accounts: string[]
    categories: CategoryRef[]
    counterparties: string[]
    tags: string[]
  }
  /** Names matched to existing FinFlow items (counts for the preview). */
  matched: { accounts: number; categories: number; counterparties: number; tags: number }
  counts: FinmapCounts
}
