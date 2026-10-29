import { LedgerError } from './errors'
import type { LedgerTransaction } from './types'

/** The fields that must keep matching the bank statement. */
const LOCKED = ['type', 'status', 'accountId', 'amountMinor', 'paymentDate'] as const

/** An operation imported from a bank may change everything except what the statement fixes. */
export function assertBankUnlocked(prior: LedgerTransaction, next: LedgerTransaction): void {
  for (const field of LOCKED) {
    if (prior[field] !== next[field]) throw new LedgerError('bank_locked', field)
  }
}
