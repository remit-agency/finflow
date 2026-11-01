export const TX_TYPES = ['income', 'expense', 'transfer'] as const
export type TxType = (typeof TX_TYPES)[number]

export const TX_STATUSES = ['actual', 'planned'] as const
export type TxStatus = (typeof TX_STATUSES)[number]

export const ACCOUNT_TYPES = ['bank', 'cash', 'card', 'crypto'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const LEDGER_CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH'] as const

/**
 * The arrival day of a transfer (`toDate`, S10b) is at most this many days from its payment day. Banks book the two sides
 * of an own transfer within a few days; the journal's balance read relies on the bound (lib/server/journal/read.ts reads
 * the transfers of these days around a page instead of an index on `toDate`).
 */
export const MAX_ARRIVAL_DAYS = 7

/** When an operation counts for the P&L: on one day, or spread over a period. */
export type Accrual = { mode: 'date'; date: string } | { mode: 'period'; from: string; to: string }

/** The evidence stored next to a converted amount (a final NBP snapshot, S04). */
export interface RateEvidence {
  rate: number
  from: string
  to: string
  requestedDate: string
  rateDate: string
  tableNo: string | null
  source: 'NBP_A' | 'identity'
}

export interface Fx {
  payment?: RateEvidence
  accrual?: RateEvidence
}

/** The amount in the company currency (minor units), per date. */
export interface Base {
  payment: number
  accrual: number
}

/** Where an operation imported from a bank came from (S09). Absent on a manual operation. */
export interface BankInfo {
  /** Id of the `bankAccounts` document the operation was imported through. */
  accountRef: string
  entryReference?: string
  /** The other party as the bank names it (not a FinFlow counterparty). */
  counterpartyName?: string
  remittance?: string
}

/**
 * The incoming bank side of a transfer (S10b): the bank block of the income it was and that income's bank key (its id was
 * `bk_` + key). Its amount, currency and day are the transfer's own `toAmountMinor`, `toCurrency` and `toDate ??
 * paymentDate`, which the bank lock keeps.
 */
export interface BankToInfo extends BankInfo {
  key: string
}

/** A rule that filled the category or the counterparty of an operation (S10): its id and its name at that moment. */
export interface AutoRuleRef {
  id: string
  name: string
}

export interface LedgerTransaction {
  id: string
  type: TxType
  status: TxStatus
  accountId: string
  /** Positive, in the minor units of `currency`. */
  amountMinor: number
  /** Always the currency of `accountId`. */
  currency: string
  toAccountId?: string
  toAmountMinor?: number
  toCurrency?: string
  /**
   * The day the money arrived on `toAccountId` (S10b), stored only when the receiving bank booked it on another day than
   * `paymentDate` (at most MAX_ARRIVAL_DAYS away); absent means the payment day. Transfers only.
   */
  toDate?: string
  paymentDate: string
  accrual: Accrual
  categoryId?: string
  counterpartyId?: string
  description?: string
  isRecurring: boolean
  projectId?: string
  /** Ids of the company's tags (S10t): at most 10, none twice. */
  tags: string[]
  fileUrls: string[]
  /** Only actual income/expense in a currency other than the company's. */
  fx?: Fx
  base?: Base
  bank?: BankInfo
  /** The incoming side of a transfer when that side was a bank operation (S10b); `bank` is then the outgoing one. Transfers only. */
  bankTo?: BankToInfo
  /** The rules that filled the category or the counterparty (S10). A person's change of either removes it. */
  autoRules?: AutoRuleRef[]
  /**
   * True when at least one of the tags has «Не враховувати в аналітиці» (S10t): the rollups of the operation go to the
   * `x_` documents, its balance effects stay. Set by the ledger at every write, never taken from a request; absent means
   * false (operations written before S10t).
   */
  excluded?: boolean
}

export interface LedgerAccount {
  id: string
  name: string
  type: AccountType
  currency: string
  color: string
  openingMinor: number
  balanceMinor: number
}
