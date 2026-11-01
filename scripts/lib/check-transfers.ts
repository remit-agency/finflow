// Pure part of scripts/check-transfers.ts (S10b rollout check). Unit-tested in Vitest.

/** What the check read for one company: counts only. */
export interface TransferCheck {
  /** Operations of the last 90 days the suggestions read (at most 2000). */
  scanned: number
  /** Of those, bank incomes and expenses that can be a side of a transfer. */
  bankSides: number
  /** Pairs the journal would suggest. */
  pairs: number
  /** Sides with more than one candidate: not suggested, left to the person. */
  ambiguous: number
  /** The read stopped at its limit. */
  truncated: boolean
  /** Transfers that already carry a bank side (none before the rollout). */
  bankTransfers: number
}

export function transferCheckLine(orgId: string, c: TransferCheck): string {
  const read = `${c.bankSides} bank operation(s) of ${c.scanned} read${c.truncated ? ' (cut at the read limit)' : ''}`
  return `org ${orgId}: ${c.pairs} pair(s) to suggest, ${c.ambiguous} ambiguous side(s), ${read}, ${c.bankTransfers} transfer(s) with a bank side`
}

export function sumChecks(checks: readonly TransferCheck[]): TransferCheck {
  return checks.reduce(
    (sum, c) => ({
      scanned: sum.scanned + c.scanned,
      bankSides: sum.bankSides + c.bankSides,
      pairs: sum.pairs + c.pairs,
      ambiguous: sum.ambiguous + c.ambiguous,
      truncated: sum.truncated || c.truncated,
      bankTransfers: sum.bankTransfers + c.bankTransfers,
    }),
    { scanned: 0, bankSides: 0, pairs: 0, ambiguous: 0, truncated: false, bankTransfers: 0 },
  )
}
