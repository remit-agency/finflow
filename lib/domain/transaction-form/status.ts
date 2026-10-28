import type { TxStatus } from '@/lib/domain/ledger/types'

/** Days are `YYYY-MM-DD`, so string comparison is date comparison. An empty or half typed value is never "future". */
export function isFutureDay(paymentDate: string, today: string): boolean {
  return paymentDate > today
}

/** A payment date after today forces a planned operation: the server refuses an actual one in the future. */
export function effectiveStatus(chosen: TxStatus, paymentDate: string, today: string): TxStatus {
  return isFutureDay(paymentDate, today) ? 'planned' : chosen
}

/** The payment date of an operation marked as paid: the planned date, or today when that is still ahead. */
export function paidDay(paymentDate: string, today: string): string {
  return isFutureDay(paymentDate, today) ? today : paymentDate
}
