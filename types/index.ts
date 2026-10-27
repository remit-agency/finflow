import type { Accrual, TxStatus } from '@/lib/domain/ledger/types'
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
  tags: string[]
  fileUrls: string[]
}
