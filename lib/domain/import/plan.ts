import { isDay } from '@/lib/domain/ledger/days'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import type { ImportOp, RefusalReason } from './types'

export interface JudgeContext {
  accountCurrency: string
  statementCurrency: string | null
  /** The Warsaw day. */
  today: string
}

/** The reason an operation cannot be written (it is then counted as refused and never marked), or null. Pure. */
export function judgeOp(op: ImportOp, ctx: JudgeContext): RefusalReason | null {
  if (ctx.statementCurrency !== ctx.accountCurrency) return 'currency_mismatch'
  if (!isDay(op.day) || op.day < '2000-01-01') return 'date'
  if (op.day > ctx.today) return 'future_date'
  if (!Number.isSafeInteger(op.amountMinor) || op.amountMinor <= 0 || op.amountMinor > MAX_MINOR) return 'amount'
  return null
}

/** What `overlapsBank` needs from an operation a bank sync wrote (S09). */
export interface BankOpView {
  type: 'income' | 'expense'
  amountMinor: number
  entryReference?: string
}

/**
 * The line is already in the account through the bank sync: same direction and amount (the caller passes only the
 * bank operations of the line's day), and the same reference when both have one. Known risk: a bank API reference and an
 * MT940 `//ref` usually differ, so with both present this rarely matches (S14 spec, decision 2).
 */
export function overlapsBank(op: ImportOp, bankOps: readonly BankOpView[]): boolean {
  return bankOps.some((b) => b.type === op.type && b.amountMinor === op.amountMinor && (op.reference === null || b.entryReference === undefined || b.entryReference === op.reference))
}
