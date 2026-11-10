import type { Accrual, AutoRuleRef, BankInfo, BankToInfo, TxStatus } from '@/lib/domain/ledger/types'
import type { Role } from '@/lib/shell/permissions'

export interface Organization {
  id: string
  name: string
  currency: string
  ownerId: string
  plan: 'trial' | 'pro' | 'free'
  trialEndsAt: Date
  createdAt: Date
}

export interface OrgMember {
  uid: string
  name: string
  email: string
  role: Role
}

export interface Account {
  id: string
  orgId: string
  name: string
  type: 'bank' | 'cash' | 'card' | 'crypto'
  /** Current balance: opening balance plus the actual operations. */
  balance: number
  /** Opening balance. */
  opening: number
  currency: string
  color: string
}

export interface Category {
  id: string
  orgId: string
  name: string
  type: 'income' | 'expense'
  color: string
  parentId?: string
}

export interface Transaction {
  id: string
  orgId: string
  accountId: string
  type: 'income' | 'expense' | 'transfer'
  status: TxStatus
  amount: number
  currency: string
  /** Transfers only. */
  toAccountId?: string
  toAmount?: number
  toCurrency?: string
  categoryId?: string
  counterpartyId?: string
  /** The payment date as a Date at 00:00 UTC. */
  date: Date
  accrual: Accrual
  description?: string
  isRecurring: boolean
  projectId?: string
  /** Ids of the company's tags (S10t). */
  tags: string[]
  fileUrls: string[]
  /** Set on an operation imported from a bank (S09). */
  bank?: BankInfo
  /** The incoming side of a transfer when it came from a bank (S10b). */
  bankTo?: BankToInfo
  /** The day the money arrived on `toAccountId` (`YYYY-MM-DD`), when it differs from the payment day (S10b). */
  toDate?: string
  /** The rules that filled the category or the counterparty (S10). */
  autoRules?: AutoRuleRef[]
  /** One of the tags keeps the operation out of Cash Flow and P&L (S10t); the balances still count it. */
  excluded?: boolean
  /** The series this operation is an occurrence of (S11), and that occurrence's day. Set by the server only. */
  seriesId?: string
  occurrence?: string
  /** The amount is an estimate (S11). */
  estimated?: boolean
  /** A person changed this planned occurrence: its series no longer rewrites it (S11). */
  manual?: boolean
}
