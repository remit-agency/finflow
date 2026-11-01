import { pairKeyOf } from './dismissed'
import type { TransferOutcome, TransferSuggestion } from './types'

/**
 * The suggested pairs that are still open after a confirmation: the ones whose transfer went through are dropped (the
 * dialog must not send them again), the failed ones stay with their place in the list.
 */
export function withoutDone(pairs: readonly TransferSuggestion[], outcomes: readonly TransferOutcome[]): TransferSuggestion[] {
  const done = new Set(outcomes.flatMap((o) => (o.ok ? [pairKeyOf(o.ids[0], o.ids[1])] : [])))
  return pairs.filter((p) => !done.has(pairKeyOf(p.from.id, p.to.id)))
}
