import { sameTags } from '@/lib/domain/tags/assign'
import { LedgerError } from './errors'
import type { Accrual, LedgerTransaction, TxType } from './types'

/**
 * The fields a series sets on its planned occurrences (S11), the one list both rules use: a person's change of any of them
 * makes the occurrence manual (`withSeries`), and a change of the series rewrites exactly these (`rewriteDiffers`). The
 * project and the files of a plan are not the series' to set: a rewrite keeps them.
 */
export const SERIES_SET = [
  'type', 'status', 'accountId', 'amountMinor', 'paymentDate', 'accrual', 'isRecurring', 'categoryId', 'counterpartyId', 'description', 'tags',
] as const

function sameAccrual(a: Accrual, b: Accrual): boolean {
  if (a.mode === 'date') return b.mode === 'date' && a.date === b.date
  return b.mode === 'period' && a.from === b.from && a.to === b.to
}

function sameField(a: LedgerTransaction, b: LedgerTransaction, field: (typeof SERIES_SET)[number]): boolean {
  if (field === 'tags') return sameTags(a.tags, b.tags)
  if (field === 'accrual') return sameAccrual(a.accrual, b.accrual)
  return a[field] === b[field]
}

/** Whether two operations differ in a field the series sets. */
export function seriesSetDiffers(a: LedgerTransaction, b: LedgerTransaction): boolean {
  return SERIES_SET.some((field) => !sameField(a, b, field))
}

/**
 * Whether a rewrite of a plan (`want`, built from the series) changes the stored plan: a field the series sets, or its
 * estimate flag, which the series owns too (a person's amount change clears it, and then the plan is manual anyway).
 */
export function rewriteDiffers(stored: LedgerTransaction, want: LedgerTransaction): boolean {
  return seriesSetDiffers(stored, want) || (stored.estimated === true) !== (want.estimated === true)
}

/**
 * An operation of a series is never a transfer (C2): the link would make the transfer unreadable (`parseTransaction`), and a
 * transfer moves balances the series does not own. Refused as `series_transfer` on `type`. The server asks before it reads
 * the accounts a transfer names, so a bad destination account does not hide this refusal.
 */
export function assertNotSeriesTransfer(prior: Pick<LedgerTransaction, 'seriesId'>, type: TxType): void {
  if (prior.seriesId !== undefined && type === 'transfer') throw new LedgerError('series_transfer', 'type')
}

/**
 * `next` (an edit, built from the request) with the series link of `prior` (S11): `seriesId`, `occurrence`, `estimated`,
 * `manual` come from the stored document only. A planned occurrence that stays planned becomes `manual` when a field its
 * series sets changes (then a change of the series no longer rewrites it), and loses `estimated` when its amount changes.
 * Marking it paid (or back) keeps the flags as they were: the operation is simply no longer a plan.
 */
export function withSeries(next: LedgerTransaction, prior: LedgerTransaction): LedgerTransaction {
  assertNotSeriesTransfer(prior, next.type)
  const out: LedgerTransaction = { ...next }
  delete out.seriesId
  delete out.occurrence
  delete out.estimated
  delete out.manual
  if (prior.seriesId === undefined || prior.occurrence === undefined) return out
  out.seriesId = prior.seriesId
  out.occurrence = prior.occurrence
  let estimated = prior.estimated === true
  let manual = prior.manual === true
  if (prior.status === 'planned' && next.status === 'planned') {
    if (next.amountMinor !== prior.amountMinor) estimated = false
    if (seriesSetDiffers(prior, next)) manual = true
  }
  if (estimated) out.estimated = true
  if (manual) out.manual = true
  return out
}

/** What a write does to the mark of its occurrence (`recurringDone`, S11): mark it paid, mark it deleted, or remove the mark. */
export type MarkChange = 'paid' | 'clear' | 'deleted'

/**
 * The one rule of the occurrence marks a ledger write moves (`commit` in lib/server/ledger/write.ts applies it):
 * - a plan becomes actual («Позначити сплаченою»): `paid` (the operation itself paid it);
 * - an actual one goes back to a plan (the undo of that): `clear`;
 * - a plan is deleted by a person: `deleted` (the generator never brings it back);
 * - an operation comes back under its plan id (the undo of a delete or of «Пропустити»): `clear` as a plan, `paid` as actual.
 * Deleting an actual occurrence leaves its `paid` mark (the occurrence stays paid). Operations without a series move none.
 */
export function markChangeOf(prior: LedgerTransaction | null, next: LedgerTransaction | null): MarkChange | null {
  const subject = next ?? prior
  if (subject === null || subject.seriesId === undefined) return null
  if (prior === null) return (next as LedgerTransaction).status === 'planned' ? 'clear' : 'paid'
  if (next === null) return prior.status === 'planned' ? 'deleted' : null
  if (prior.status === 'planned' && next.status === 'actual') return 'paid'
  if (prior.status === 'actual' && next.status === 'planned') return 'clear'
  return null
}
