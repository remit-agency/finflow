import { fromDay } from '@/lib/domain/ledger/days'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { Account, Transaction } from '@/types'

export function toUiAccount(orgId: string, a: LedgerAccount): Account {
  return {
    id: a.id,
    orgId,
    name: a.name,
    type: a.type,
    currency: a.currency,
    color: a.color,
    balance: fromMinor(a.balanceMinor),
    opening: fromMinor(a.openingMinor),
  }
}

export function toUiTransaction(orgId: string, tx: LedgerTransaction): Transaction {
  const ui: Transaction = {
    id: tx.id,
    orgId,
    accountId: tx.accountId,
    type: tx.type,
    status: tx.status,
    amount: fromMinor(tx.amountMinor),
    currency: tx.currency,
    date: fromDay(tx.paymentDate),
    accrual: tx.accrual,
    isRecurring: tx.isRecurring,
    tags: tx.tags,
    fileUrls: tx.fileUrls,
  }
  if (tx.toAccountId !== undefined) ui.toAccountId = tx.toAccountId
  if (tx.toAmountMinor !== undefined) ui.toAmount = fromMinor(tx.toAmountMinor)
  if (tx.toCurrency !== undefined) ui.toCurrency = tx.toCurrency
  if (tx.categoryId !== undefined) ui.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) ui.counterpartyId = tx.counterpartyId
  if (tx.description !== undefined) ui.description = tx.description
  if (tx.projectId !== undefined) ui.projectId = tx.projectId
  return ui
}
