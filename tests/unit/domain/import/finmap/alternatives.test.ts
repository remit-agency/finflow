import { describe, expect, it } from 'vitest'
import { alternativeIndices } from '@/lib/domain/import/finmap/alternatives'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import type { FinmapExisting, FinmapRow, PlannedOp } from '@/lib/domain/import/finmap/types'

// Synthetic rows only: an expense and an income at the same day, minute and amount on two accounts pair into one transfer.
const row = (over: Partial<FinmapRow>): FinmapRow => ({
  line: 2, paymentDay: '2026-10-05', timeText: '46000.5', minute: 720, amountMinor: 500,
  from: null, to: null, category: null, subcategory: null, counterparty: null,
  hasSubcounterparty: false, hasProject: false, tags: [], comment: null, period: null,
  ...over,
})
const EXPENSE = row({ line: 2, from: 'Konto A' })
const INCOME = row({ line: 3, to: 'Konto B' })
const UNRELATED = row({ line: 4, from: 'Konto C', amountMinor: 900 })
const existing: FinmapExisting = {
  companyCurrency: 'PLN',
  accounts: [{ id: 'a', name: 'Konto A', currency: 'PLN' }, { id: 'b', name: 'Konto B', currency: 'PLN' }, { id: 'c', name: 'Konto C', currency: 'PLN' }],
  categories: [], counterparties: [], tags: [],
}
const plan = (pairTransfers: boolean, rows: FinmapRow[]) =>
  planFinmap(rows, existing, { includePlanned: false, pairTransfers, today: '2026-10-20' }).operations

describe('alternativeIndices', () => {
  it('a transfer made of two rows is an alternative of each single of those rows', () => {
    const paired = plan(true, [EXPENSE, INCOME, UNRELATED])
    const single = plan(false, [EXPENSE, INCOME, UNRELATED])
    expect(paired.map((o) => o.kind)).toEqual(['transfer', 'expense'])
    expect(alternativeIndices(paired, single)).toEqual([[0, 1], []])
  })

  it('a single row is an alternative of the transfer that covers its line, and of nothing else', () => {
    const paired = plan(true, [EXPENSE, INCOME, UNRELATED])
    const single = plan(false, [EXPENSE, INCOME, UNRELATED])
    // The singles of the pairing-off plan are in sheet order: expense (line 2), income (line 3), the unrelated expense (line 4).
    expect(single.map((o) => o.lines)).toEqual([[2], [3], [4]])
    expect(alternativeIndices(single, paired)).toEqual([[0], [0], []])
  })

  it('an operation has no alternative of its own shape: a single is not an alternative of a single on the same line', () => {
    const single = plan(false, [EXPENSE, INCOME])
    expect(alternativeIndices(single, plan(false, [EXPENSE, INCOME]))).toEqual([[], []])
  })

  it('is empty for an operation whose lines the other plan does not have', () => {
    const ops: PlannedOp[] = plan(true, [UNRELATED])
    expect(alternativeIndices(ops, plan(false, [EXPENSE, INCOME]))).toEqual([[]])
  })
})
