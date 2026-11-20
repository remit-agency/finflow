import { describe, expect, it } from 'vitest'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import { NAME_LIMITS, parseFinmapSetup, SETUP_LIMITS } from '@/lib/domain/import/finmap/request'
import type { FinmapExisting, FinmapOptions, FinmapRow } from '@/lib/domain/import/finmap/types'

// Synthetic rows only: the names here are made up.
const row = (over: Partial<FinmapRow> = {}): FinmapRow => ({
  line: 2, paymentDay: '2026-10-05', timeText: '46000.5', minute: 720, amountMinor: 1000,
  from: 'Konto A', to: null, category: null, subcategory: null, counterparty: null,
  hasSubcounterparty: false, hasProject: false, tags: [], comment: null, period: null,
  ...over,
})
const sheet = (...items: Array<Partial<FinmapRow>>): FinmapRow[] => items.map((o, i) => row({ line: i + 2, ...o }))
const existing: FinmapExisting = { companyCurrency: 'PLN', accounts: [], categories: [], counterparties: [], tags: [] }
const opts: FinmapOptions = { includePlanned: false, pairTransfers: true, today: '2026-10-20' }

const KINDS: Array<{ kind: string; max: number; over: (n: number) => Partial<FinmapRow> }> = [
  { kind: 'account on the expense side', max: NAME_LIMITS.account, over: (n) => ({ from: 'A'.repeat(n) }) },
  { kind: 'account on the income side', max: NAME_LIMITS.account, over: (n) => ({ from: null, to: 'B'.repeat(n) }) },
  { kind: 'category', max: NAME_LIMITS.category, over: (n) => ({ category: 'C'.repeat(n) }) },
  { kind: 'subcategory', max: NAME_LIMITS.category, over: (n) => ({ category: 'Jedzenie', subcategory: 'S'.repeat(n) }) },
  { kind: 'counterparty', max: NAME_LIMITS.counterparty, over: (n) => ({ counterparty: 'P'.repeat(n) }) },
  { kind: 'tag', max: NAME_LIMITS.tag, over: (n) => ({ tags: ['T'.repeat(n)] }) },
]

describe('planFinmap: names the setup step would reject', () => {
  it.each(KINDS)('refuses a row whose $kind is one character over the cap', ({ max, over }) => {
    const plan = planFinmap(sheet(over(max + 1)), existing, opts)
    expect(plan.operations).toEqual([])
    expect(plan.counts.refused).toEqual({ name: 1 })
  })

  it.each(KINDS)('accepts a row whose $kind is exactly at the cap', ({ max, over }) => {
    const plan = planFinmap(sheet(over(max)), existing, opts)
    expect(plan.operations).toHaveLength(1)
    expect(plan.counts.refused).toEqual({})
  })

  it('refuses a name with no letter or digit, as the setup step does', () => {
    const plan = planFinmap(sheet({ counterparty: '---' }, { tags: ['…'] }), existing, opts)
    expect(plan.operations).toEqual([])
    expect(plan.counts.refused).toEqual({ name: 2 })
  })

  it('leaves the other rows alone: only the row with the long name is refused', () => {
    const plan = planFinmap(sheet({ from: 'Konto A' }, { counterparty: 'P'.repeat(NAME_LIMITS.counterparty + 1) }, { from: 'Konto A', amountMinor: 700 }), existing, opts)
    expect(plan.operations.map((o) => o.lines)).toEqual([[2], [4]])
    expect(plan.counts.refused).toEqual({ name: 1 })
    expect(plan.counts.expense).toBe(2)
  })

  it('does not pair a transfer from a row whose name is refused', () => {
    const plan = planFinmap(sheet({ from: 'Konto A', to: null, amountMinor: 500 }, { from: null, to: 'L'.repeat(NAME_LIMITS.account + 1), amountMinor: 500 }), existing, opts)
    expect(plan.operations).toHaveLength(1)
    expect(plan.operations[0]).toMatchObject({ kind: 'expense', account: 'Konto A', toAccount: null })
    expect(plan.counts.transfer).toBe(0)
    expect(plan.counts.refused).toEqual({ name: 1 })
  })

  it('a subcategory that would be ignored (no real category) is not checked', () => {
    const plan = planFinmap(sheet({ category: null, subcategory: 'S'.repeat(NAME_LIMITS.category + 1) }), existing, opts)
    expect(plan.operations).toHaveLength(1)
    expect(plan.counts.refused).toEqual({})
  })
})

describe('the planner and the setup parser share the name limits', () => {
  it('the setup step refuses one character over each limit and accepts the limit itself', () => {
    const setup = (name: string, field: string) => parseFinmapSetup({
      fileName: 'a.xlsx',
      accounts: field === 'accounts' ? [{ name, type: 'bank', currency: 'PLN', currentBalanceMinor: null }] : [],
      categories: field === 'categories' ? [{ type: 'expense', parent: name, child: null }] : [],
      counterparties: field === 'counterparties' ? [name] : [],
      tags: field === 'tags' ? [name] : [],
    })
    expect(setup('A'.repeat(NAME_LIMITS.account), 'accounts').ok).toBe(true)
    expect(setup('A'.repeat(NAME_LIMITS.account + 1), 'accounts')).toEqual({ ok: false, field: 'accounts[0].name' })
    expect(setup('C'.repeat(NAME_LIMITS.category), 'categories').ok).toBe(true)
    expect(setup('C'.repeat(NAME_LIMITS.category + 1), 'categories')).toEqual({ ok: false, field: 'categories[0].parent' })
    expect(setup('P'.repeat(NAME_LIMITS.counterparty), 'counterparties').ok).toBe(true)
    expect(setup('P'.repeat(NAME_LIMITS.counterparty + 1), 'counterparties')).toEqual({ ok: false, field: 'counterparties[0]' })
    expect(setup('T'.repeat(NAME_LIMITS.tag), 'tags').ok).toBe(true)
    expect(setup('T'.repeat(NAME_LIMITS.tag + 1), 'tags')).toEqual({ ok: false, field: 'tags[0]' })
  })

  it('the collection limits the dialog checks against are the ones the setup step enforces', () => {
    expect(SETUP_LIMITS).toEqual({ accounts: 200, categories: 5000, counterparties: 5000, tags: 500 })
  })
})
