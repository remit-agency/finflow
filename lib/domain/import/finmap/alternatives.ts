import type { PlannedOp } from './types'

/**
 * The other shape of the same sheet rows (S14b duplicate check). A transfer is made of two rows: planned with pairing off, those
 * rows are two singles, and a single row is part of a transfer planned with pairing on. Keys are the same for the same identity and
 * ordinal, so a file imported one way must be recognised the other way too.
 *
 * For each operation of `ops`, the indices in `other` (the same rows planned with the pairing flipped) that share one of its sheet
 * lines and are of the other shape (a transfer against singles, a single against transfers). Sorted, and empty when none. Pure.
 */
export function alternativeIndices(ops: readonly PlannedOp[], other: readonly PlannedOp[]): number[][] {
  const byLine = new Map<number, number[]>()
  other.forEach((o, j) => {
    for (const line of o.lines) {
      const list = byLine.get(line)
      if (list === undefined) byLine.set(line, [j])
      else list.push(j)
    }
  })
  return ops.map((op) => {
    const found = new Set<number>()
    for (const line of op.lines) {
      for (const j of byLine.get(line) ?? []) if (isTransfer(other[j]) !== isTransfer(op)) found.add(j)
    }
    return [...found].sort((a, b) => a - b)
  })
}

const isTransfer = (op: PlannedOp): boolean => op.kind === 'transfer'
