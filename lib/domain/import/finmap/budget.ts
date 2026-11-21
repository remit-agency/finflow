import type { ChangeSet } from '@/lib/domain/ledger/change'
import { WRITE_BUDGET } from './types'

/** What one operation adds to a transaction: the documents its change touches (`accounts/{id}`, `rollups/{id}`). */
export interface OpFootprint {
  docs: readonly string[]
}

/** The documents a change set writes (`accounts/{id}` for each balance, `rollups/{id}` for each rollup): the footprint of a change. */
export function footprintOf(change: ChangeSet): string[] {
  return [...Object.keys(change.balanceDeltas).map((id) => `accounts/${id}`), ...[...change.rollupDeltas.keys()].map((id) => `rollups/${id}`)]
}

/**
 * The writes of a transaction that holds `ops` operations and changes `docs` distinct documents: 2 per operation (its
 * document and its mark), the documents, and 1 audit entry.
 */
export const writesOf = (ops: number, docs: number): number => ops * 2 + docs + 1

/**
 * Splits operations, in order, into groups whose Firestore transaction stays within `budget` writes. An operation alone
 * always fits a group (it is never split), so every group has at least one operation.
 */
export function splitByWriteBudget(footprints: readonly OpFootprint[], budget: number = WRITE_BUDGET): number[][] {
  const groups: number[][] = []
  let current: number[] = []
  let docs = new Set<string>()
  for (let i = 0; i < footprints.length; i++) {
    const withOp = new Set([...docs, ...footprints[i].docs])
    if (current.length > 0 && writesOf(current.length + 1, withOp.size) > budget) {
      groups.push(current)
      current = []
      docs = new Set(footprints[i].docs)
    } else {
      docs = withOp
    }
    current.push(i)
  }
  if (current.length > 0) groups.push(current)
  return groups
}
