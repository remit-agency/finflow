import { addDays } from './days'
import { LedgerError } from './errors'
import { bad } from './guards'
import type { TransactionInput } from './input'
import { mulRate } from './money'
import type { Base, Fx, LedgerTransaction, RateEvidence } from './types'

/** Operations may be planned at most this many days ahead. */
export const MAX_FUTURE_DAYS = 3650

export interface AccountRef {
  id: string
  currency: string
}

export interface BuildContext {
  /** The Warsaw day, supplied by the caller. */
  today: string
  account: AccountRef
  toAccount?: AccountRef
  /** The category document the request names, or null when it does not exist / none was named. */
  category: { type: 'income' | 'expense' } | null
  baseCurrency: string
}

export function buildTransaction(id: string, input: TransactionInput, ctx: BuildContext): LedgerTransaction {
  if (input.accountId !== ctx.account.id) throw new LedgerError('account_not_found', 'accountId')

  const horizon = addDays(ctx.today, MAX_FUTURE_DAYS)
  if (input.status === 'actual' && input.paymentDate > ctx.today) throw new LedgerError('future_actual', 'paymentDate')
  if (input.paymentDate > horizon) bad('paymentDate')
  const accrualEnd = input.accrual.mode === 'date' ? input.accrual.date : input.accrual.to
  if (accrualEnd > horizon) bad('accrual')

  if (input.type !== 'transfer' && input.categoryId !== undefined) {
    if (ctx.category === null || ctx.category.type !== input.type) throw new LedgerError('category_not_found', 'categoryId')
  }

  const tx: LedgerTransaction = {
    id,
    type: input.type,
    status: input.status,
    accountId: input.accountId,
    amountMinor: input.amountMinor,
    currency: ctx.account.currency,
    paymentDate: input.paymentDate,
    accrual: input.accrual,
    isRecurring: input.isRecurring,
    tags: input.tags,
    fileUrls: input.fileUrls,
  }
  if (input.categoryId !== undefined) tx.categoryId = input.categoryId
  if (input.counterpartyId !== undefined) tx.counterpartyId = input.counterpartyId
  if (input.description !== undefined) tx.description = input.description
  if (input.projectId !== undefined) tx.projectId = input.projectId

  if (input.type === 'transfer') {
    const to = ctx.toAccount
    if (!to || to.id !== input.toAccountId) throw new LedgerError('account_not_found', 'toAccountId')
    if (to.id === ctx.account.id) bad('toAccountId')
    tx.toAccountId = to.id
    tx.toCurrency = to.currency
    if (to.currency === ctx.account.currency) {
      if (input.toAmountMinor !== undefined && input.toAmountMinor !== input.amountMinor) bad('toAmountMinor')
      tx.toAmountMinor = input.amountMinor
    } else {
      if (input.toAmountMinor === undefined) bad('toAmountMinor')
      tx.toAmountMinor = input.toAmountMinor
    }
  }
  return tx
}

export type FxKey = 'payment' | 'accrual'

export interface FxRequest {
  keys: FxKey[]
  from: string
  to: string
  date: string
}

/**
 * The rates an operation needs: only an actual income/expense in a currency other than the company's.
 * The payment rate is for the payment date; the accrual rate is for the accrual date (a period's start),
 * capped at today so a stored snapshot is always final.
 */
export function fxPlan(tx: LedgerTransaction, baseCurrency: string, today: string): FxRequest[] {
  if (tx.status !== 'actual' || tx.type === 'transfer' || tx.currency === baseCurrency) return []
  const anchor = tx.accrual.mode === 'date' ? tx.accrual.date : tx.accrual.from
  const accrualDate = anchor > today ? today : anchor
  const common = { from: tx.currency, to: baseCurrency }
  if (accrualDate === tx.paymentDate) return [{ keys: ['payment', 'accrual'], ...common, date: tx.paymentDate }]
  return [
    { keys: ['payment'], ...common, date: tx.paymentDate },
    { keys: ['accrual'], ...common, date: accrualDate },
  ]
}

/** Stores the resolved evidence (one per request of `plan`, same order) and the base amounts. */
export function attachFx(tx: LedgerTransaction, plan: FxRequest[], evidence: RateEvidence[]): LedgerTransaction {
  const { fx: _fx, base: _base, ...rest } = tx
  void _fx
  void _base
  if (plan.length === 0) return rest
  const fx: Fx = {}
  const base: Partial<Base> = {}
  plan.forEach((request, i) => {
    for (const key of request.keys) {
      fx[key] = evidence[i]
      base[key] = mulRate(tx.amountMinor, evidence[i].rate)
    }
  })
  return { ...rest, fx, base: base as Base }
}

/** The amounts in the company currency, or null when an operation in another currency lacks them. */
export function baseOf(tx: LedgerTransaction, baseCurrency: string): Base | null {
  if (tx.currency === baseCurrency) return { payment: tx.amountMinor, accrual: tx.amountMinor }
  return tx.base ?? null
}
