import { sameTags } from '@/lib/domain/tags/assign'
import type { LedgerTransaction } from './types'

/** The fields of an operation its series sets (S11). A person's change of any of them on a planned occurrence makes it manual. */
const SERIES_SET = ['type', 'accountId', 'amountMinor', 'paymentDate', 'categoryId', 'counterpartyId', 'description'] as const

/**
 * `next` (an edit, built from the request) with the series link of `prior` (S11): `seriesId`, `occurrence`, `estimated`,
 * `manual` come from the stored document only. A planned occurrence that stays planned becomes `manual` when a field its
 * series sets changes (then a change of the series no longer rewrites it), and loses `estimated` when its amount changes.
 * Marking it paid (or back) keeps the flags as they were: the operation is simply no longer a plan.
 */
export function withSeries(next: LedgerTransaction, prior: LedgerTransaction): LedgerTransaction {
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
    if (SERIES_SET.some((field) => prior[field] !== next[field]) || !sameTags(prior.tags, next.tags)) manual = true
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
