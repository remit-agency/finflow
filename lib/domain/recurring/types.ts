import type { TxType } from '@/lib/domain/ledger/types'

/** Schema of a series document (`organizations/{org}/recurring/{id}`, S11). */
export const RECURRING_SCHEMA_VERSION = 1
/** Schema of an occurrence mark (`organizations/{org}/recurringDone/{planId}`, S11). */
export const DONE_SCHEMA_VERSION = 1

export const FREQUENCIES = ['weekly', 'monthly', 'everyNMonths', 'yearly'] as const
export type Frequency = (typeof FREQUENCIES)[number]
export const WEEKEND_RULES = ['none', 'next', 'previous'] as const
export type WeekendRule = (typeof WEEKEND_RULES)[number]
export const PRESETS = ['zus', 'pit4', 'vat7'] as const
export type Preset = (typeof PRESETS)[number]
export const SERIES_STATUSES = ['active', 'paused'] as const
export type SeriesStatus = (typeof SERIES_STATUSES)[number]
export const SERIES_KINDS = ['income', 'expense'] as const
export type SeriesKind = (typeof SERIES_KINDS)[number]
export const DONE_REASONS = ['paid', 'skipped', 'deleted'] as const
export type DoneReason = (typeof DONE_REASONS)[number]

/** Series one company may have (a technical limit; plan limits arrive in S17). */
export const MAX_SERIES = 100
export const SERIES_NAME_MAX = 80
/** As the comment of an operation (lib/domain/ledger/input.ts). */
export const SERIES_DESCRIPTION_MAX = 500
/** «Кожні N місяців»: N is 1-24. */
export const MAX_INTERVAL = 24
/** Planned operations reach this many months ahead of today. */
export const WINDOW_MONTHS = 3
/** A payment day is at most this many days from its occurrence (a weekend plus Polish holidays). */
export const MAX_SHIFT_DAYS = 7
/** Occurrences one fill of one series creates at most; the rest follows in the next fill (catch-up after a long pause). */
export const MAX_FILL_PER_SERIES = 100
/** Future operations of a series one change, pause or delete rewrites at most (the 500-write limit of a transaction). */
export const REWRITE_CAP = 100
/** Marks of a series one change reads at most (the periods they take). */
export const MARKS_SCAN = 500
/** The largest JSON body of the recurring routes. */
export const RECURRING_BODY_MAX_BYTES = 64 * 1024
/** A bank operation pays a plan from this many days before the plan's payment day ... */
export const MATCH_BEFORE_DAYS = 3
/** ... to this many days after it. */
export const MATCH_AFTER_DAYS = 10
/** Plans overdue for longer than this are not offered for a match. */
export const MATCH_LOOKBACK_DAYS = 90
/** Plans one suggestions read takes at most. */
export const MATCH_PLAN_SCAN = 500
/** Bank operations one suggestions read takes at most. */
export const MATCH_BANK_SCAN = 2000
/** Pairs one answer offers at most, newest first. */
export const MAX_MATCHES = 50
/** Pairs (or undos) one `POST /recurring/matches` takes at most. */
export const MAX_MATCH_ITEMS = 50
/** «Найближчі 7 днів»: today and the six days after it. */
export const UPCOMING_DAYS = 7
/** The page lists the planned operations of the next 31 days ... */
export const LIST_DAYS = 31
/** ... at most this many, and at most this many overdue ones. */
export const LIST_ROWS = 50
/** Planned operations one overview reads at most (today to the window end). */
export const PLANNED_SCAN = 1500
/** Series one daily run looks at, at most; the rest wait for the next hourly call. */
export const CRON_MAX_SERIES = 200
/** The daily fill may take at most this long of one hourly call ... */
export const RECURRING_CRON_BUDGET_MS = 10_000
/** ... and never past this point of the route's 60 s (`maxDuration` of app/api/cron/bank-sync). */
export const CRON_ROUTE_BUDGET_MS = 55_000
/** `createdBy` and the audit `uid` of what the daily fill writes. */
export const RECURRING_UID = 'system'

/** When a series repeats. Days are `YYYY-MM-DD` (UTC days), never moments. */
export interface Schedule {
  frequency: Frequency
  /** `everyNMonths` only: 1-24; 1 for the other frequencies. */
  interval: number
  /** monthly, everyNMonths, yearly: 1-31 (a shorter month takes its last day); null for weekly. */
  dayOfMonth: number | null
  /** weekly only: ISO weekday, 1 Monday ... 7 Sunday; null otherwise. */
  weekday: number | null
  /** The first occurrence is the first rule day on or after it; everyNMonths and yearly count their periods from its month. */
  startDate: string
  /** The last day an occurrence may fall on (included). */
  endDate?: string
  /** What a payment day that is not a Polish business day becomes. */
  weekendRule: WeekendRule
}

export interface Series extends Schedule {
  id: string
  name: string
  kind: SeriesKind
  accountId: string
  categoryId?: string
  counterpartyId?: string
  /** Tag ids, at most 10. */
  tags: string[]
  description?: string
  /** In the minor units of `currency`. */
  amountMinor: number
  /** Always the currency of `accountId`. */
  currency: string
  /** The amount is only an estimate (a tax): a match compares the counterparty instead. */
  estimated: boolean
  preset?: Preset
  status: SeriesStatus
  /** The last day the window of planned operations was filled to (absent before the first fill). */
  generatedThrough?: string
  /** The Warsaw day the daily fill is due again; absent when paused or nothing is left to create. */
  dueOn?: string
}

/** What a confirmed match copied from the plan onto the bank operation (only what it lacked). */
export interface Carried {
  categoryId?: string
  counterpartyId?: string
  description?: string
  tags?: string[]
}

/** One settled occurrence: paid, skipped or deleted by a person. Its id is the plan id. Written by the server only. */
export interface DoneMark {
  id: string
  seriesId: string
  occurrence: string
  reason: DoneReason
  /** paid: the operation that paid it (the plan itself after «Позначити сплаченою», or the bank operation of a match). */
  txId?: string
  /** The flags the plan had, so that a restore brings them back. */
  estimated: boolean
  manual: boolean
  /** A match only: the plan's stored fields (`transactionToDoc`), which the undo puts back. */
  plan?: Record<string, unknown>
  /** A match only: what the bank operation took over, which the undo takes off again while unchanged. */
  carried?: Carried
}
export type DoneMarkFields = Omit<DoneMark, 'id'>

/** One planned operation as the overview reads it (selected fields). */
export interface PlannedRow {
  id: string
  type: TxType
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  seriesId?: string
  occurrence?: string
  estimated: boolean
  manual: boolean
  categoryId?: string
  counterpartyId?: string
  description?: string
}

export interface CurrencyTotal {
  currency: string
  amountMinor: number
}

/** A series with the day its next payment is planned for (null: paused or ended). */
export interface SeriesRow extends Series {
  next: string | null
}

/** `GET /recurring`. */
export interface RecurringOverview {
  series: SeriesRow[]
  /** Planned operations before today, all of them. */
  overdueCount: number
  /** The oldest overdue ones, at most LIST_ROWS. */
  overdue: PlannedRow[]
  /** The planned operations of today and the next LIST_DAYS - 1 days, at most LIST_ROWS. */
  upcoming: PlannedRow[]
  /** «Найближчі 7 днів» per currency. */
  soon: { income: CurrencyTotal[]; expense: CurrencyTotal[] }
  /** The read of the window stopped at PLANNED_SCAN. */
  truncated: boolean
}

/** The plan of a suggested match. */
export interface PlanSide {
  id: string
  version: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  seriesId: string
  occurrence: string
  estimated: boolean
  counterpartyId?: string
  description?: string
  /** The series' name, when the series still exists. */
  name?: string
}

/** The bank operation of a suggested match. */
export interface BankSide {
  id: string
  version: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  counterpartyId?: string
  counterpartyName?: string
  remittance?: string
}

export interface PlanMatch {
  plan: PlanSide
  bank: BankSide
}

/** `GET /recurring/suggestions`. */
export interface MatchSuggestions {
  /** At most MAX_MATCHES, newest first. */
  pairs: PlanMatch[]
  /** Unambiguous pairs found, before the cap. */
  total: number
  /** Sides with more than one candidate: not offered, left to the person. */
  ambiguous: number
  /** A read stopped at its limit. */
  truncated: boolean
}

/** A parsed body of `POST /recurring/matches`. */
export type MatchRequest =
  | { kind: 'confirm'; items: { planId: string; bankId: string; versions: [string, string] }[] }
  | { kind: 'undo'; planIds: string[] }

/** The result of one pair (or one undo). */
export type MatchOutcome = { planId: string; ok: true; bankId: string } | { planId: string; ok: false; code: string }

/** What `DELETE /recurring/{id}` does with the future unpaid plans. */
export type FutureMode = 'delete' | 'keep'

/** The part `recurring` of the hourly `POST /api/cron/bank-sync` answer: counts only. */
export interface RecurringCronSummary {
  /** Due series the run read (at most CRON_MAX_SERIES). */
  considered: number
  filled: number
  /** Planned operations created. */
  created: number
  /** Not filled this hour: out of time, or no longer due. */
  skipped: number
  failed: number
}
