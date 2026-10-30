import { baseOf } from '@/lib/domain/ledger/build'
import type { Accrual, LedgerTransaction, TxType } from '@/lib/domain/ledger/types'

/** What a bulk change may set. `null` clears the field. */
export interface BulkPatch {
  categoryId?: string | null
  counterpartyId?: string | null
  description?: string | null
  paymentDate?: string
  accrual?: Accrual
  /** Tags to add (S10t). A tag change never goes together with the fields above. */
  addTagIds?: string[]
  /** Tags to take off (S10t). */
  removeTagIds?: string[]
}

/** A bulk change of the tags (S10t): the server computes each operation's new list instead of setting a field. */
export function isTagPatch(patch: BulkPatch): boolean {
  return patch.addTagIds !== undefined || patch.removeTagIds !== undefined
}

export type SkipReason = 'transfer' | 'future_actual'

/** Categories have a type, so a category can be set only on a selection of one type; transfers have none. */
export function categoryTypeOf(rows: LedgerTransaction[]): 'income' | 'expense' | null {
  const types = new Set<TxType>(rows.filter((r) => r.type !== 'transfer').map((r) => r.type))
  if (types.size !== 1) return null
  return types.has('income') ? 'income' : 'expense'
}

/** A transfer has no category, counterparty or accrual (it has no P&L side). */
export function patchTouches(patch: BulkPatch, type: TxType): boolean {
  return type === 'transfer' && ('categoryId' in patch || 'counterpartyId' in patch || 'accrual' in patch)
}

/** Splits a selection into what the patch applies to and what is skipped, before anything is sent. */
export function splitByPatch(
  rows: LedgerTransaction[],
  patch: BulkPatch,
  today: string,
): { apply: LedgerTransaction[]; skipped: { id: string; reason: SkipReason }[] } {
  const apply: LedgerTransaction[] = []
  const skipped: { id: string; reason: SkipReason }[] = []
  for (const tx of rows) {
    if (patchTouches(patch, tx.type)) skipped.push({ id: tx.id, reason: 'transfer' })
    else if (patch.paymentDate !== undefined && patch.paymentDate > today && tx.status === 'actual') skipped.push({ id: tx.id, reason: 'future_actual' })
    else apply.push(tx)
  }
  return { apply, skipped }
}

/** The number of rows and the net company-currency amount of the actual income and expense among them. */
export function selectionSummary(rows: LedgerTransaction[], baseCurrency: string): { count: number; totalBaseMinor: number } {
  let total = 0
  for (const tx of rows) {
    if (tx.status !== 'actual' || tx.type === 'transfer') continue
    const base = baseOf(tx, baseCurrency)
    if (!base) continue
    total += tx.type === 'income' ? base.payment : -base.payment
  }
  return { count: rows.length, totalBaseMinor: total }
}

/** The checked ids and the scope (the filters) they were checked in. */
export interface ScopedSelection {
  scope: string
  ids: ReadonlySet<string>
}

/**
 * The selection for `scope`: the same object while the scope is the same, an empty one for the new scope otherwise.
 * The old scope's ids are dropped for good, so going back to an earlier scope (search, then clear the search) does
 * not bring them back.
 */
export function selectionForScope(state: ScopedSelection, scope: string): ScopedSelection {
  return state.scope === scope ? state : { scope, ids: new Set() }
}

/** The failure code that occurs most often (the first one seen wins a tie); null when nothing failed. */
export function mostFrequentCode(failed: { code: string }[]): string | null {
  const counts = new Map<string, number>()
  let best: string | null = null
  for (const { code } of failed) {
    const n = (counts.get(code) ?? 0) + 1
    counts.set(code, n)
    if (best === null || n > (counts.get(best) as number)) best = code
  }
  return best
}
