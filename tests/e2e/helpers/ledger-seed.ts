import type { APIRequestContext } from '@playwright/test'
import { seedDoc } from './emulator-firestore'

/**
 * Seeds for the schema 2 ledger (S05). The browser can no longer write accounts or operations
 * (the rules close them), so specs that need data written "from outside" create it as admin here,
 * in the exact shape the server stores. The documents are written without rollups or audit
 * entries: they are enough for the UI reads, not for `verifyLedger`.
 */

/** Integer minor units (1/100) of a major-unit amount typed in a test. */
export function minor(amount: number): number {
  return Math.round(amount * 100)
}

/** The `YYYY-MM-DD` UTC day of a date. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export interface SeedAccount {
  name: string
  /** The current balance in major units; the opening balance is the same unless `opening` says otherwise. */
  balance: number
  opening?: number
  currency: string
  color?: string
  type?: 'bank' | 'cash' | 'card' | 'crypto'
}

export async function seedLedgerAccount(
  request: APIRequestContext,
  orgId: string,
  id: string,
  data: SeedAccount,
): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/accounts`, id, {
    name: data.name,
    type: data.type ?? 'bank',
    currency: data.currency,
    color: data.color ?? '#00c896',
    openingMinor: minor(data.opening ?? data.balance),
    balanceMinor: minor(data.balance),
    schemaVersion: 2,
    orgId,
    createdAt: new Date(),
  })
}

export interface SeedOperation {
  type: 'income' | 'expense' | 'transfer'
  accountId: string
  amount: number
  currency: string
  /** The payment day; the accrual is the same day. */
  date?: Date | string
  description?: string
  categoryId?: string
  counterpartyId?: string
  projectId?: string
  tags?: string[]
  /** Default: the payment day. */
  accrual?: { mode: 'date'; date: string } | { mode: 'period'; from: string; to: string }
  toAccountId?: string
  toAmount?: number
  toCurrency?: string
}

export async function seedLedgerOperation(
  request: APIRequestContext,
  orgId: string,
  id: string,
  data: SeedOperation,
): Promise<void> {
  const day = typeof data.date === 'string' ? data.date : utcDay(data.date ?? new Date())
  await seedDoc(request, `organizations/${orgId}/transactions`, id, {
    type: data.type,
    status: 'actual',
    accountId: data.accountId,
    amountMinor: minor(data.amount),
    currency: data.currency,
    toAccountId: data.toAccountId,
    toAmountMinor: data.toAmount === undefined ? undefined : minor(data.toAmount),
    toCurrency: data.toCurrency,
    paymentDate: day,
    accrual: data.accrual ?? { mode: 'date', date: day },
    categoryId: data.categoryId,
    counterpartyId: data.counterpartyId,
    projectId: data.projectId,
    description: data.description,
    isRecurring: false,
    tags: data.tags ?? [],
    fileUrls: [],
    schemaVersion: 2,
    orgId,
    createdAt: new Date(),
  })
}
