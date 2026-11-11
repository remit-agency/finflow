// tests/unit/domain/reports/fixtures.ts
// Operations for the S12 domain tests (Task 5 adds the categories, the labels and the sample reports).
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

let seq = 0

/** An actual operation in PLN with its accrual on the payment day; `fields` overrides any of it. A transfer gets the same amount in. */
export function op(fields: Pick<LedgerTransaction, 'type' | 'accountId' | 'amountMinor' | 'paymentDate'> & Partial<LedgerTransaction>): LedgerTransaction {
  seq += 1
  const tx: LedgerTransaction = {
    id: `t${seq}`,
    status: 'actual',
    currency: 'PLN',
    accrual: { mode: 'date', date: fields.paymentDate },
    isRecurring: false,
    tags: [],
    fileUrls: [],
    ...fields,
  }
  if (tx.type === 'transfer') {
    tx.toAmountMinor ??= tx.amountMinor
    tx.toCurrency ??= tx.currency
  }
  return tx
}
