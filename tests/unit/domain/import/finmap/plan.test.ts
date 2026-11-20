import { describe, expect, it } from 'vitest'
import { MAX_FUTURE_DAYS } from '@/lib/domain/ledger/build'
import { addDays } from '@/lib/domain/ledger/days'
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
      // Another amount: with the same day, minute and amount these two would pair (no real category on either side).
      { from: null, to: 'Konto B', category: 'KATEGORIE DOCHODÓW', amountMinor: 2000 },
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

const EXPENSE = { from: 'Konto A', to: null, amountMinor: 500, comment: null }
const INCOME = { from: null, to: 'Konto B', amountMinor: 500, comment: null }
const twoAccounts = existing({
  accounts: [{ id: 'a1', name: 'Konto A', currency: 'PLN' }, { id: 'b1', name: 'Konto B', currency: 'PLN' }],
})

describe('planFinmap: transfer pairing', () => {
  it('an expense and an income at the same day, minute and amount on other accounts become one transfer', () => {
    const plan = planFinmap(sheet({ ...EXPENSE, comment: 'Zakup' }, { ...INCOME, tags: ['x'] }), existing(), opts())
    expect(plan.operations).toEqual([expect.objectContaining({
      kind: 'transfer', status: 'actual', day: '2026-10-05', amountMinor: 500, account: 'Konto A', toAccount: 'Konto B',
      toAmountMinor: null, category: null, counterparty: null, tags: ['x'], description: 'Zakup', accrual: null, lines: [2, 3],
    })])
    expect(plan.counts).toMatchObject({ rows: 2, transfer: 1, expense: 0, income: 0 })
    expect(plan.create.accounts).toEqual(['Konto A', 'Konto B'])
  })

  it('the transfer takes the income comment when the expense has none; tags are the union in first-use order', () => {
    const plan = planFinmap(sheet(
      { ...EXPENSE, tags: ['a', 'b'] },
      { ...INCOME, comment: 'Przelew', tags: ['B', 'c'] },
    ), twoAccounts, opts())
    expect(plan.operations[0]).toMatchObject({ description: 'Przelew', tags: ['a', 'b', 'c'] })
  })

  it('a paired transfer sits at the position of its first row in the sheet, for ordinals and order', () => {
    const plan = planFinmap(sheet(EXPENSE, { ...EXPENSE, amountMinor: 700 }, INCOME), twoAccounts, opts())
    expect(plan.operations.map((o) => [o.kind, o.lines])).toEqual([['transfer', [2, 4]], ['expense', [3]]])
  })

  it('the identity of a transfer is the two rows identities joined by "+", so it differs from either row alone', () => {
    const paired = planFinmap(sheet(EXPENSE, INCOME), twoAccounts, opts())
    const single = planFinmap(sheet(EXPENSE, INCOME), twoAccounts, opts({ pairTransfers: false }))
    const expIdentity = ['46000.5', '500', 'expense', '', '', '', '', '']
    const incIdentity = ['46000.5', '500', 'income', '', '', '', '', '']
    expect(paired.operations[0].identity).toEqual([...expIdentity, '+', ...incIdentity])
    expect(single.operations.map((o) => o.identity)).toEqual([expIdentity, incIdentity])
  })

  it('a transfer never carries an accrual: a valid period on a folded row is counted as ignored', () => {
    const period = { from: '2026-01-01', to: '2026-03-31' }
    const plan = planFinmap(sheet({ ...EXPENSE, period }, { ...INCOME }), twoAccounts, opts())
    expect(plan.operations[0].accrual).toBeNull()
    expect(plan.counts.warnings.accrualIgnored).toBe(1)
  })

  it('no pair when a side has a real category: counted in pairCandidatesLeft once per pair', () => {
    const plan = planFinmap(sheet(
      { ...EXPENSE, category: 'Transport' }, INCOME,
      { ...EXPENSE, minute: 800 }, { ...INCOME, minute: 800, category: 'Dom' },
    ), twoAccounts, opts({ pairTransfers: true }))
    expect(plan.counts.transfer).toBe(0)
    expect(plan.counts.pairCandidatesLeft).toBe(2)
    expect(plan.counts).toMatchObject({ expense: 2, income: 2 })
  })

  it('no pair when a side has a counterparty, and it is counted', () => {
    const plan = planFinmap(sheet({ ...EXPENSE, counterparty: 'Orlen' }, INCOME), twoAccounts, opts())
    expect(plan.counts).toMatchObject({ transfer: 0, pairCandidatesLeft: 1 })
  })

  it('no pair when the group holds two expenses (and nothing is counted)', () => {
    const plan = planFinmap(sheet(EXPENSE, { ...EXPENSE, from: 'Konto C' }, INCOME), twoAccounts, opts())
    expect(plan.counts).toMatchObject({ transfer: 0, expense: 2, income: 1, pairCandidatesLeft: 0 })
  })

  it('no pair when both accounts are the same account (by name), and nothing is counted', () => {
    const plan = planFinmap(sheet(EXPENSE, { ...INCOME, to: 'konto a' }), twoAccounts, opts())
    expect(plan.counts).toMatchObject({ transfer: 0, pairCandidatesLeft: 0 })
  })

  it('no pair when the currencies differ, with or without a category (not counted)', () => {
    const eur = existing({
      accounts: [{ id: 'a1', name: 'Konto A', currency: 'PLN' }, { id: 'b1', name: 'Konto B', currency: 'EUR' }],
    })
    expect(planFinmap(sheet(EXPENSE, INCOME), eur, opts()).counts).toMatchObject({ transfer: 0, pairCandidatesLeft: 0 })
    expect(planFinmap(sheet({ ...EXPENSE, category: 'Transport' }, INCOME), eur, opts()).counts)
      .toMatchObject({ transfer: 0, pairCandidatesLeft: 0 })
  })

  it('a new account takes the company currency unless newAccountCurrency says otherwise', () => {
    expect(planFinmap(sheet(EXPENSE, INCOME), existing({ companyCurrency: 'PLN' }), opts()).counts.transfer).toBe(1)
    const oneKnown = existing({ companyCurrency: 'PLN', accounts: [{ id: 'a1', name: 'Konto A', currency: 'PLN' }] })
    expect(planFinmap(sheet(EXPENSE, INCOME), oneKnown, opts({ newAccountCurrency: { 'konto b': 'EUR' } })).counts.transfer).toBe(0)
    expect(planFinmap(sheet(EXPENSE, INCOME), oneKnown, opts({ newAccountCurrency: { 'konto b': 'PLN' } })).counts.transfer).toBe(1)
  })

  it('pairTransfers false: no transfer and pairCandidatesLeft is 0, even for a category case', () => {
    const plan = planFinmap(sheet(EXPENSE, INCOME, { ...EXPENSE, minute: 800, category: 'Transport' }, { ...INCOME, minute: 800 }),
      twoAccounts, opts({ pairTransfers: false }))
    expect(plan.counts).toMatchObject({ transfer: 0, expense: 2, income: 2, pairCandidatesLeft: 0 })
  })

  it('planned rows are not paired', () => {
    const plan = planFinmap(sheet({ ...EXPENSE, paymentDay: '2026-10-25' }, { ...INCOME, paymentDay: '2026-10-25' }),
      twoAccounts, opts({ includePlanned: true }))
    expect(plan.counts).toMatchObject({ transfer: 0, planned: 2 })
  })
})

describe('planFinmap: determinism and totals', () => {
  it('the same rows give the same plan', () => {
    const rs = sheet(EXPENSE, INCOME, EXPENSE, {}, { category: 'Transport' }, { paymentDay: null })
    expect(planFinmap(rs, twoAccounts, opts())).toEqual(planFinmap(rs, twoAccounts, opts()))
  })

  it('income + expense + 2 * transfer + refused equals the rows, for 200 seeded random sheets', () => {
    let seed = 1
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
    for (let round = 0; round < 200; round++) {
      const n = 1 + Math.floor(rand() * 40)
      const rs = sheet(...Array.from({ length: n }, () => ({
        paymentDay: pick(['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-25', null]),
        minute: pick([600, 601]),
        amountMinor: pick([1000, 1000, 2000, 0, null]),
        from: pick(['Konto A', null]),
        to: pick([null, 'Konto B', 'Konto A']),
        category: pick([null, 'Transport']),
        counterparty: pick([null, 'Orlen']),
        tags: pick([[], ['x']]),
        comment: pick([null, 'c']),
      })))
      const plan = planFinmap(rs, twoAccounts, opts({ includePlanned: rand() < 0.5, pairTransfers: rand() < 0.5 }))
      const c = plan.counts
      const refusedTotal = Object.values(c.refused).reduce((a, b) => a + (b ?? 0), 0)
      expect(c.rows).toBe(n)
      expect(c.income + c.expense + 2 * c.transfer + refusedTotal).toBe(n)
    }
  })
})

// One run on the owner-size scale with synthetic rows: about 40 000 rows, 700 expense+income pairs, many identical rows.
describe('planFinmap: the ledger horizon (MAX_FUTURE_DAYS, the ledger refuses a day or an accrual end after it)', () => {
  const today = '2026-10-20'
  const horizon = addDays(today, MAX_FUTURE_DAYS)
  const afterHorizon = addDays(horizon, 1)

  it('accepts a payment day on the horizon day and refuses the day after it as a date', () => {
    const plan = planFinmap(sheet({ paymentDay: horizon }, { paymentDay: afterHorizon }), existing(), opts({ includePlanned: true, today }))
    expect(plan.operations.map((o) => o.day)).toEqual([horizon])
    expect(plan.counts.refused).toEqual({ date: 1 })
  })

  it('refuses a payment far beyond the horizon as a date, with or without planned rows', () => {
    for (const includePlanned of [true, false]) {
      const plan = planFinmap(sheet({ paymentDay: '2040-01-01' }), existing(), opts({ includePlanned, today }))
      expect(plan.operations).toEqual([])
      expect(plan.counts.refused).toEqual({ date: 1 })
    }
  })

  it('accepts an accrual that ends on the horizon day and refuses one that ends the day after as accrual_after_horizon', () => {
    const from = addDays(horizon, -40)
    const plan = planFinmap(sheet(
      { paymentDay: today, period: { from, to: horizon } },
      { paymentDay: today, period: { from, to: afterHorizon } },
    ), existing(), opts({ today }))
    expect(plan.operations.map((o) => o.accrual)).toEqual([{ from, to: horizon }])
    expect(plan.counts.refused).toEqual({ accrual_after_horizon: 1 })
    expect(plan.counts.warnings.accrualIgnored).toBe(0)
  })
})

// Prints the elapsed time; asserts counts only. Runs with FINMAP_LARGE=1.
describe.skipIf(process.env.FINMAP_LARGE !== '1')('planFinmap at 40 000 rows', () => {
  it('plans the rows and reports the time', () => {
    const rs: FinmapRow[] = []
    for (let k = 0; k < 700; k++) {
      const day = new Date(Date.UTC(2026, 0, 1) + (k % 300) * 86400000).toISOString().slice(0, 10)
      const common = { paymentDay: day, minute: (k * 7) % 1440, amountMinor: 100 + k, timeText: `t${k}` }
      rs.push(row({ ...common, line: rs.length + 2, from: 'Konto A', to: null }))
      rs.push(row({ ...common, line: rs.length + 2, from: null, to: 'Konto B' }))
    }
    while (rs.length < 40_000) {
      rs.push(row({ line: rs.length + 2, paymentDay: '2026-12-01', minute: 600, amountMinor: 100 + (rs.length % 50), from: `Konto ${rs.length % 7}`, to: null, comment: 'Zakup', timeText: '46000.5' }))
    }
    const t0 = performance.now()
    const plan = planFinmap(rs, twoAccounts, opts({ today: '2026-12-31' }))
    const ms = Math.round(performance.now() - t0)
    console.log(`planFinmap 40 000 rows: ${ms} ms (one run, synthetic rows)`)
    expect(plan.counts).toMatchObject({ rows: 40_000, transfer: 700, expense: 38_600, income: 0 })
  })
})
