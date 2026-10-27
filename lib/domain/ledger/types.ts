export const TX_TYPES = ['income', 'expense', 'transfer'] as const
export type TxType = (typeof TX_TYPES)[number]

export const TX_STATUSES = ['actual', 'planned'] as const
export type TxStatus = (typeof TX_STATUSES)[number]

export const ACCOUNT_TYPES = ['bank', 'cash', 'card', 'crypto'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const LEDGER_CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH'] as const

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
  paymentDate: string
  accrual: Accrual
  categoryId?: string
  counterpartyId?: string
  description?: string
  isRecurring: boolean
  projectId?: string
  tags: string[]
  fileUrls: string[]
  /** Only actual income/expense in a currency other than the company's. */
  fx?: Fx
  base?: Base
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
