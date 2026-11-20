import { describe, expect, it } from 'vitest'
import { finmapIdentity, planFinmap } from '@/lib/domain/import/finmap/plan'
import type { FinmapExisting, FinmapOptions, FinmapRow } from '@/lib/domain/import/finmap/types'

// Synthetic rows only (not the owner's file): every name, amount and comment here is made up for the test.
const row = (over: Partial<FinmapRow> = {}): FinmapRow => ({
  line: 2, paymentDay: '2026-10-05', timeText: '46000.5', minute: 720, amountMinor: 1000,
  from: 'Konto A', to: null, category: null, subcategory: null, counterparty: null,
  hasSubcounterparty: false, hasProject: false, tags: [], comment: null, period: null,
  ...over,
})
/** Rows in sheet order: the first row is line 2 (the header is line 1). */
const sheet = (...items: Array<Partial<FinmapRow>>): FinmapRow[] => items.map((o, i) => row({ line: i + 2, ...o }))
const existing = (over: Partial<FinmapExisting> = {}): FinmapExisting => ({
  companyCurrency: 'PLN', accounts: [], categories: [], counterparties: [], tags: [], ...over,
})
const opts = (over: Partial<FinmapOptions> = {}): FinmapOptions => ({ includePlanned: false, pairTransfers: true, today: '2026-10-20', ...over })

describe('planFinmap: direction and refusals', () => {
  it('a row with only "from" is an expense on that account', () => {
    const plan = planFinmap(sheet({ from: 'Konto A', to: null, amountMinor: 1250 }), existing(), opts())
    expect(plan.operations).toEqual([expect.objectContaining({
      kind: 'expense', status: 'actual', day: '2026-10-05', amountMinor: 1250, account: 'Konto A', toAccount: null, lines: [2],
    })])
    expect(plan.counts.expense).toBe(1)
  })

  it('a row with only "to" is an income on that account', () => {
    const plan = planFinmap(sheet({ from: null, to: 'Konto B' }), existing(), opts())
    expect(plan.operations).toEqual([expect.objectContaining({ kind: 'income', account: 'Konto B', toAccount: null })])
    expect(plan.counts.income).toBe(1)
  })

  it('refuses a row with neither account or with both', () => {
    const plan = planFinmap(sheet({ from: null, to: null }, { from: 'Konto A', to: 'Konto B' }), existing(), opts())
    expect(plan.operations).toEqual([])
    expect(plan.counts.refused).toEqual({ account: 2 })
  })

  it('refuses an unreadable date, an amount that is missing, not positive or too big, and counts each reason', () => {
    const plan = planFinmap(sheet(
      { paymentDay: null },
      { amountMinor: null },
      { amountMinor: 0 },
      { amountMinor: -5 },
      { amountMinor: 10 ** 13 + 1 },
      { from: null, to: null },
      {},
    ), existing(), opts())
    expect(plan.counts.refused).toEqual({ date: 1, amount: 4, account: 1 })
    expect(plan.counts.rows).toBe(7)
    expect(plan.counts.expense).toBe(1)
    expect(plan.operations).toHaveLength(1)
  })
})

describe('planFinmap: planned rows', () => {
  it('a row after today is a planned operation when includePlanned is on', () => {
    const plan = planFinmap(sheet({ paymentDay: '2026-10-25' }), existing(), opts({ includePlanned: true }))
    expect(plan.operations).toEqual([expect.objectContaining({ status: 'planned', day: '2026-10-25' })])
    expect(plan.counts.planned).toBe(1)
    expect(plan.counts.expense).toBe(1)
    expect(plan.period).toEqual({ from: '2026-10-25', to: '2026-10-25' })
  })

  it('a row after today is refused planned_off when includePlanned is off', () => {
    const plan = planFinmap(sheet({ paymentDay: '2026-10-25' }, {}), existing(), opts({ includePlanned: false }))
    expect(plan.counts.refused).toEqual({ planned_off: 1 })
    expect(plan.counts.planned).toBe(0)
    expect(plan.operations.map((o) => o.day)).toEqual(['2026-10-05'])
  })

  it('period is null when there are no operations', () => {
    const plan = planFinmap(sheet({ amountMinor: 0 }), existing(), opts())
    expect(plan.operations).toEqual([])
    expect(plan.period).toBeNull()
  })
})

describe('planFinmap: categories', () => {
  it('a built-in "no category" name is no category, in either case', () => {
    const plan = planFinmap(sheet(
      { category: 'Kategorie wydatków' },
      { from: null, to: 'Konto B', category: 'KATEGORIE DOCHODÓW' },
    ), existing(), opts())
    expect(plan.operations.map((o) => o.category)).toEqual([null, null])
    expect(plan.create.categories).toEqual([])
    expect(plan.counts.warnings.categoryIgnored).toBe(0)
  })

  it('a subcategory under a built-in name is ignored and counted', () => {
    const plan = planFinmap(sheet({ category: 'Kategorie wydatków', subcategory: 'Paliwo' }), existing(), opts())
    expect(plan.operations[0].category).toBeNull()
    expect(plan.counts.warnings.categoryIgnored).toBe(1)
  })

  it('a real category and subcategory become a reference by names, typed by the row direction', () => {
    const plan = planFinmap(sheet(
      { category: 'Transport', subcategory: 'Paliwo' },
      { from: null, to: 'Konto B', category: 'Wynagrodzenie' },
    ), existing(), opts())
    expect(plan.operations[0].category).toEqual({ type: 'expense', parent: 'Transport', child: 'Paliwo' })
    expect(plan.operations[1].category).toEqual({ type: 'income', parent: 'Wynagrodzenie', child: null })
  })

  it('creates missing categories parents first, in first-use order, without repeats', () => {
    const plan = planFinmap(sheet(
      { category: 'Transport', subcategory: 'Paliwo' },
      { category: 'Dom' },
      { category: 'transport', subcategory: 'Parking' },
      { category: 'Transport', subcategory: 'Paliwo' },
    ), existing(), opts())
    // A parent is named by its first spelling, also in its children's references.
    expect(plan.create.categories).toEqual([
      { type: 'expense', parent: 'Transport', child: null },
      { type: 'expense', parent: 'Transport', child: 'Paliwo' },
      { type: 'expense', parent: 'Dom', child: null },
      { type: 'expense', parent: 'Transport', child: 'Parking' },
    ])
  })
})

describe('planFinmap: matching existing items', () => {
  it('an account matches by name, ignoring case and double spaces; the file spelling stays on the operation', () => {
    const plan = planFinmap(sheet({ from: 'Konto A' }), existing({ accounts: [{ id: 'a1', name: 'konto  a', currency: 'PLN' }] }), opts())
    expect(plan.create.accounts).toEqual([])
    expect(plan.matched.accounts).toBe(1)
    expect(plan.operations[0].account).toBe('Konto A')
  })

  it('categories match by type and name, and a child by its parent', () => {
    const plan = planFinmap(sheet({ category: 'JEDZENIE', subcategory: 'SKLEP' }), existing({
      categories: [
        { id: 'c1', name: 'Jedzenie  ', type: 'expense' },
        { id: 'c2', name: 'Sklep', type: 'expense', parentId: 'c1' },
      ],
    }), opts())
    expect(plan.create.categories).toEqual([])
    expect(plan.matched.categories).toBe(2)
  })

  it('a child with the right name under another parent is created again', () => {
    const plan = planFinmap(sheet({ category: 'Jedzenie', subcategory: 'Sklep' }), existing({
      categories: [
        { id: 'c1', name: 'Jedzenie', type: 'expense' },
        { id: 'c9', name: 'Inne', type: 'expense' },
        { id: 'c2', name: 'Sklep', type: 'expense', parentId: 'c9' },
      ],
    }), opts())
    expect(plan.create.categories).toEqual([{ type: 'expense', parent: 'Jedzenie', child: 'Sklep' }])
    expect(plan.matched.categories).toBe(1)
  })

  it('counterparties and tags match case-insensitively; the rest are created once, first spelling kept', () => {
    const plan = planFinmap(sheet(
      { counterparty: 'biedronka', tags: ['DOM', 'Wakacje'] },
      { counterparty: 'Lidl', tags: ['wakacje'] },
      { counterparty: 'LIDL' },
    ), existing({ counterparties: [{ id: 'p1', name: 'Biedronka' }], tags: [{ id: 't1', name: 'Dom' }] }), opts())
    expect(plan.create.counterparties).toEqual(['Lidl'])
    expect(plan.create.tags).toEqual(['Wakacje'])
    expect(plan.matched.counterparties).toBe(1)
    expect(plan.matched.tags).toBe(1)
  })

  it('accounts that do not exist yet are created once per normalised name, first spelling kept', () => {
    const plan = planFinmap(sheet({ from: 'Konto B' }, { from: 'konto b' }, { from: null, to: 'Konto C' }), existing(), opts())
    expect(plan.create.accounts).toEqual(['Konto B', 'Konto C'])
    expect(plan.matched.accounts).toBe(0)
  })
})

describe('planFinmap: accrual, comment and warnings', () => {
  it('keeps a valid period of up to 36 months as the accrual', () => {
    const plan = planFinmap(sheet(
      { period: { from: '2026-01-01', to: '2026-03-31' } },
      { period: { from: '2024-01-01', to: '2026-12-31' } },
    ), existing(), opts())
    expect(plan.operations.map((o) => o.accrual)).toEqual([
      { from: '2026-01-01', to: '2026-03-31' },
      { from: '2024-01-01', to: '2026-12-31' },
    ])
    expect(plan.counts.warnings.accrualIgnored).toBe(0)
  })

  it('ignores a period longer than 36 months, or one that ends before it starts, and counts it', () => {
    const plan = planFinmap(sheet(
      { period: { from: '2020-01-01', to: '2023-02-01' } },
      { period: { from: '2026-05-01', to: '2026-04-01' } },
      { period: null },
    ), existing(), opts())
    expect(plan.operations.map((o) => o.accrual)).toEqual([null, null, null])
    expect(plan.counts.warnings.accrualIgnored).toBe(2)
  })

  it('cuts a comment to 500 characters and counts the cut; a 500-character comment is kept', () => {
    const plan = planFinmap(sheet({ comment: 'x'.repeat(600) }, { comment: 'y'.repeat(500) }), existing(), opts())
    expect(plan.operations[0].description).toHaveLength(500)
    expect(plan.operations[1].description).toHaveLength(500)
    expect(plan.counts.warnings.commentCut).toBe(1)
  })

  it('counts subcounterparty and project notes without changing the operation', () => {
    const plan = planFinmap(sheet({ hasSubcounterparty: true, hasProject: true }, {}), existing(), opts())
    expect(plan.counts.warnings.subcounterparty).toBe(1)
    expect(plan.counts.warnings.project).toBe(1)
    expect(plan.operations).toHaveLength(2)
  })
})

describe('planFinmap: identity and ordinals', () => {
  it('the identity is the time text, amount, kind, and the normalised parts, tags sorted', () => {
    const r = row({ category: 'Transport', subcategory: 'Paliwo', counterparty: 'Orlen', comment: 'Baku', tags: ['b', 'A'] })
    expect(finmapIdentity(r)).toEqual(['46000.5', '1000', 'expense', 'transport', 'paliwo', 'orlen', 'baku', 'a|b'])
    const plan = planFinmap([r], existing(), opts())
    expect(plan.operations[0].identity).toEqual(['46000.5', '1000', 'expense', 'transport', 'paliwo', 'orlen', 'baku', 'a|b'])
  })

  it('identical rows on one account are numbered 0, 1, 2 in sheet order, per account', () => {
    const plan = planFinmap(sheet({}, {}, { from: 'Konto B' }, {}), existing(), opts())
    expect(plan.operations.map((o) => [o.account, o.lines, o.ordinal])).toEqual([
      ['Konto A', [2], 0],
      ['Konto A', [3], 1],
      ['Konto B', [4], 0],
      ['Konto A', [5], 2],
    ])
  })
})
