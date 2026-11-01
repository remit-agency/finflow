import { LedgerError } from '@/lib/domain/ledger/errors'
import { bankSideOf, mergeToTransfer } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

/**
 * The bank account a «Зробити переказом» selection comes from (S10b): every selected row is a bank income or expense of
 * that one account. Null otherwise (the bar then does not offer it).
 */
export function convertSourceOf(rows: readonly LedgerTransaction[]): { accountId: string; currency: string } | null {
  if (rows.length === 0 || rows.some((r) => bankSideOf(r) === null)) return null
  const { accountId, currency } = rows[0]
  return rows.every((r) => r.accountId === accountId) ? { accountId, currency } : null
}

/**
 * The two rows of an «Об’єднати в переказ» selection, the expense first: exactly the pair the ledger's own rule accepts
 * (`mergeToTransfer`), in whichever order they were selected. Null otherwise.
 */
export function mergePairOf(rows: readonly LedgerTransaction[]): [LedgerTransaction, LedgerTransaction] | null {
  if (rows.length !== 2) return null
  for (const [out, inc] of [[rows[0], rows[1]], [rows[1], rows[0]]] as const) {
    try {
      mergeToTransfer(out, inc)
      return [out, inc]
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e
    }
  }
  return null
}
