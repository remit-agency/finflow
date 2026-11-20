import { describe, expect, it } from 'vitest'
import { normKey } from '@/lib/domain/import/finmap/fold'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import { resolveOps } from '@/lib/domain/import/finmap/resolve'
import { parseFinmapBatch, parseFinmapCheck } from '@/lib/domain/import/finmap/request'
import type { FinmapExisting, FinmapOptions, FinmapRow } from '@/lib/domain/import/finmap/types'

// Synthetic row: every name and comment here is made up for the test.
const row = (over: Partial<FinmapRow> = {}): FinmapRow => ({
  line: 2, paymentDay: '2026-10-05', timeText: '46000.5', minute: 720, amountMinor: 1000,
  from: 'Konto A', to: null, category: null, subcategory: null, counterparty: null,
  hasSubcounterparty: false, hasProject: false, tags: [], comment: null, period: null,
  ...over,
})
const existing: FinmapExisting = {
  companyCurrency: 'PLN',
  accounts: [{ id: 'acc-a', name: 'Konto A', currency: 'PLN' }],
  categories: [],
  counterparties: [],
  tags: [],
}
const opts: FinmapOptions = { includePlanned: false, pairTransfers: true, today: '2026-10-20' }

describe('Finmap pipeline: planner, resolver and batch parser', () => {
  it('a row with a 5 000-character comment and a 3 000-character counterparty passes parseFinmapBatch', () => {
    const counterparty = 'Firma ' + 'p'.repeat(3000)
    const plan = planFinmap([row({ comment: 'k'.repeat(5000), counterparty })], existing, opts)
    expect(plan.operations).toHaveLength(1)
    // The setup step returns the id of each name it created; here the counterparty is the one new name.
    const maps = { accounts: {}, categories: [], counterparties: { [normKey(counterparty)]: 'cp-1' }, tags: {} }
    const { ops, tagsDropped } = resolveOps(plan.operations, maps, existing)
    expect(tagsDropped).toBe(0)
    expect(ops[0]).toMatchObject({ accountId: 'acc-a', counterpartyId: 'cp-1' })

    const parsed = parseFinmapBatch({ importId: 'imp_1', operations: ops })
    expect(parsed.ok).toBe(true)
  })

  it('the same row is also accepted by parseFinmapCheck, with its identity bounded', () => {
    const plan = planFinmap([row({ comment: 'k'.repeat(5000), counterparty: 'Firma ' + 'p'.repeat(3000) })], existing, opts)
    const maps = { accounts: {}, categories: [], counterparties: { ['firma ' + 'p'.repeat(3000)]: 'cp-1' }, tags: {} }
    const { ops } = resolveOps(plan.operations, maps, existing)
    const checked = parseFinmapCheck({ operations: ops.map((o) => ({ accountId: o.accountId, toAccountId: o.toAccountId, identity: o.identity, ordinal: o.ordinal })) })
    expect(checked.ok).toBe(true)
    for (const s of ops[0].identity) expect(s.length).toBeLessThanOrEqual(64)
  })
})
