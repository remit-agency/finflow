import { describe, expect, it } from 'vitest'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { parseFinmapBatch, parseFinmapCheck, parseFinmapFinish, parseFinmapSetup } from '@/lib/domain/import/finmap/request'

/** A valid setup body; each test changes one thing. */
const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  fileName: 'Platnosci.xlsx',
  accounts: [{ name: '  Konto   główne ', type: 'bank', currency: 'PLN', currentBalanceMinor: 125_050 }],
  categories: [{ type: 'expense', parent: 'Dom', child: 'Czynsz' }],
  counterparties: ['Wynajmujący sp. z o.o.'],
  tags: ['firma'],
  ...over,
})

const failsAt = (value: unknown, field: string): void => {
  const r = parseFinmapSetup(value)
  expect(r).toEqual({ ok: false, field })
}

describe('parseFinmapSetup', () => {
  it('reads a valid body and normalises the names', () => {
    const r = parseFinmapSetup(body())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.fileName).toBe('Platnosci.xlsx')
    expect(r.value.importId).toBeUndefined()
    expect(r.value.accounts).toEqual([{ name: 'Konto główne', type: 'bank', currency: 'PLN', currentBalanceMinor: 125_050 }])
    expect(r.value.categories).toEqual([{ type: 'expense', parent: 'Dom', child: 'Czynsz' }])
    expect(r.value.counterparties).toEqual(['Wynajmujący sp. z o.o.'])
    expect(r.value.tags).toEqual(['firma'])
  })

  it('accepts a retry importId, a null balance and a parent category without a child', () => {
    const r = parseFinmapSetup(body({ importId: 'imp_1', accounts: [{ name: 'Kasa', type: 'cash', currency: 'EUR', currentBalanceMinor: null }], categories: [{ type: 'income', parent: 'Sprzedaż', child: null }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.importId).toBe('imp_1')
    expect(r.value.accounts[0].currentBalanceMinor).toBeNull()
    expect(r.value.categories[0].child).toBeNull()
  })

  it('refuses a body that is not an object', () => {
    failsAt(null, 'body')
    failsAt([], 'body')
  })

  it('refuses a malformed importId', () => {
    failsAt(body({ importId: 'a/b' }), 'importId')
    failsAt(body({ importId: 7 }), 'importId')
  })

  it('refuses a missing or blank file name and one over 255 characters', () => {
    failsAt(body({ fileName: undefined }), 'fileName')
    failsAt(body({ fileName: '   ' }), 'fileName')
    failsAt(body({ fileName: 'x'.repeat(256) }), 'fileName')
  })

  it('refuses an account with a blank name, an unknown type or currency, or a balance out of range', () => {
    failsAt(body({ accounts: [{ name: ' ', type: 'bank', currency: 'PLN', currentBalanceMinor: null }] }), 'accounts[0].name')
    failsAt(body({ accounts: [{ name: 'A'.repeat(121), type: 'bank', currency: 'PLN', currentBalanceMinor: null }] }), 'accounts[0].name')
    failsAt(body({ accounts: [{ name: 'A', type: 'savings', currency: 'PLN', currentBalanceMinor: null }] }), 'accounts[0].type')
    failsAt(body({ accounts: [{ name: 'A', type: 'bank', currency: 'pln', currentBalanceMinor: null }] }), 'accounts[0].currency')
    failsAt(body({ accounts: [{ name: 'A', type: 'bank', currency: 'GBP', currentBalanceMinor: null }] }), 'accounts[0].currency')
    failsAt(body({ accounts: [{ name: 'A', type: 'bank', currency: 'PLN', currentBalanceMinor: 1.5 }] }), 'accounts[0].currentBalanceMinor')
    failsAt(body({ accounts: [{ name: 'A', type: 'bank', currency: 'PLN', currentBalanceMinor: MAX_MINOR + 1 }] }), 'accounts[0].currentBalanceMinor')
  })

  it('refuses more than 200 accounts', () => {
    const accounts = Array.from({ length: 201 }, (_, i) => ({ name: `A${i}`, type: 'bank', currency: 'PLN', currentBalanceMinor: null }))
    failsAt(body({ accounts }), 'accounts')
  })

  it('refuses a category with an unknown type, a blank parent or a blank child, and more than 5000', () => {
    failsAt(body({ categories: [{ type: 'transfer', parent: 'Dom', child: null }] }), 'categories[0].type')
    failsAt(body({ categories: [{ type: 'expense', parent: '  ', child: null }] }), 'categories[0].parent')
    failsAt(body({ categories: [{ type: 'expense', parent: 'Dom', child: '' }] }), 'categories[0].child')
    const categories = Array.from({ length: 5001 }, (_, i) => ({ type: 'expense', parent: `P${i}`, child: null }))
    failsAt(body({ categories }), 'categories')
  })

  it('refuses a counterparty or tag that is blank, has no letters or digits, or is too long; and too many of them', () => {
    failsAt(body({ counterparties: ['  '] }), 'counterparties[0]')
    failsAt(body({ counterparties: ['---'] }), 'counterparties[0]')
    failsAt(body({ counterparties: ['x'.repeat(201)] }), 'counterparties[0]')
    failsAt(body({ counterparties: Array.from({ length: 5001 }, (_, i) => `K${i}`) }), 'counterparties')
    failsAt(body({ tags: ['x'.repeat(51)] }), 'tags[0]')
    failsAt(body({ tags: ['!!'] }), 'tags[0]')
    failsAt(body({ tags: Array.from({ length: 501 }, (_, i) => `t${i}`) }), 'tags')
  })
})

describe('parseFinmapFinish', () => {
  it('reads the importId', () => {
    expect(parseFinmapFinish({ importId: 'imp_1' })).toEqual({ ok: true, value: { importId: 'imp_1' } })
  })

  it('refuses a missing or malformed importId and a body that is not an object', () => {
    expect(parseFinmapFinish({})).toEqual({ ok: false, field: 'importId' })
    expect(parseFinmapFinish({ importId: '../x' })).toEqual({ ok: false, field: 'importId' })
    expect(parseFinmapFinish('imp')).toEqual({ ok: false, field: 'body' })
  })
})

/** A valid expense of the batch; each test changes what it needs. */
const op = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'expense',
  status: 'actual',
  day: '2026-10-20',
  amountMinor: 12_345,
  accountId: 'acc-main',
  toAccountId: null,
  toAmountMinor: null,
  categoryId: 'cat-food',
  counterpartyId: null,
  tagIds: ['tag-firma'],
  description: 'Zakupy',
  accrual: null,
  identity: ['2026-10-20', 'ZAKUPY'],
  ordinal: 0,
  ...over,
})

const batchBody = (ops: Array<Record<string, unknown>> = [op()], over: Record<string, unknown> = {}): Record<string, unknown> => ({
  importId: 'imp_1',
  operations: ops,
  ...over,
})

const transfer = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  op({ kind: 'transfer', toAccountId: 'acc-2', toAmountMinor: null, categoryId: null, counterpartyId: null, tagIds: [], description: null, ...over })

describe('parseFinmapBatch', () => {
  it('reads a valid batch of an expense and a transfer', () => {
    const r = parseFinmapBatch(batchBody([op({ accrual: { from: '2026-09-01', to: '2026-10-31' } }), transfer({ toAmountMinor: 500 })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.importId).toBe('imp_1')
    expect(r.value.operations[0]).toMatchObject({ kind: 'expense', accountId: 'acc-main', toAccountId: null, tagIds: ['tag-firma'], accrual: { from: '2026-09-01', to: '2026-10-31' } })
    expect(r.value.operations[1]).toMatchObject({ kind: 'transfer', toAccountId: 'acc-2', toAmountMinor: 500, categoryId: null })
  })

  it('accepts an empty batch and a planned operation', () => {
    expect(parseFinmapBatch(batchBody([])).ok).toBe(true)
    expect(parseFinmapBatch(batchBody([op({ status: 'planned', day: '2027-03-01' })])).ok).toBe(true)
  })

  it('refuses a body that is not an object, a malformed importId, and more than 60 operations', () => {
    expect(parseFinmapBatch(null)).toEqual({ ok: false, field: 'body' })
    expect(parseFinmapBatch(batchBody([op()], { importId: 'a/b' }))).toEqual({ ok: false, field: 'importId' })
    expect(parseFinmapBatch(batchBody([op()], { importId: undefined }))).toEqual({ ok: false, field: 'importId' })
    expect(parseFinmapBatch(batchBody(Array.from({ length: 61 }, () => op())))).toEqual({ ok: false, field: 'operations' })
    expect(parseFinmapBatch(batchBody([op(), 'x' as unknown as Record<string, unknown>]))).toEqual({ ok: false, field: 'operations[1]' })
  })

  it('refuses an unknown kind or status, a day that is not one, and an amount that is not a positive minor amount', () => {
    expect(parseFinmapBatch(batchBody([op({ kind: 'split' })]))).toEqual({ ok: false, field: 'operations[0].kind' })
    expect(parseFinmapBatch(batchBody([op({ status: 'future' })]))).toEqual({ ok: false, field: 'operations[0].status' })
    expect(parseFinmapBatch(batchBody([op({ day: '2026-02-30' })]))).toEqual({ ok: false, field: 'operations[0].day' })
    expect(parseFinmapBatch(batchBody([op({ amountMinor: 0 })]))).toEqual({ ok: false, field: 'operations[0].amountMinor' })
    expect(parseFinmapBatch(batchBody([op({ amountMinor: -5 })]))).toEqual({ ok: false, field: 'operations[0].amountMinor' })
    expect(parseFinmapBatch(batchBody([op({ amountMinor: 1.5 })]))).toEqual({ ok: false, field: 'operations[0].amountMinor' })
  })

  it('refuses a transfer without a different target account, or with a category, counterparty or accrual', () => {
    expect(parseFinmapBatch(batchBody([transfer({ toAccountId: null })]))).toEqual({ ok: false, field: 'operations[0].toAccountId' })
    expect(parseFinmapBatch(batchBody([transfer({ toAccountId: 'acc-main' })]))).toEqual({ ok: false, field: 'operations[0].toAccountId' })
    expect(parseFinmapBatch(batchBody([transfer({ categoryId: 'cat-food' })]))).toEqual({ ok: false, field: 'operations[0].categoryId' })
    expect(parseFinmapBatch(batchBody([transfer({ counterpartyId: 'cp-1' })]))).toEqual({ ok: false, field: 'operations[0].counterpartyId' })
    expect(parseFinmapBatch(batchBody([transfer({ accrual: { from: '2026-10-01', to: '2026-10-31' } })]))).toEqual({ ok: false, field: 'operations[0].accrual' })
    expect(parseFinmapBatch(batchBody([transfer({ toAmountMinor: 0 })]))).toEqual({ ok: false, field: 'operations[0].toAmountMinor' })
  })

  it('refuses a target account, or a received amount, on an income or an expense', () => {
    expect(parseFinmapBatch(batchBody([op({ toAccountId: 'acc-2' })]))).toEqual({ ok: false, field: 'operations[0].toAccountId' })
    expect(parseFinmapBatch(batchBody([op({ toAmountMinor: 100 })]))).toEqual({ ok: false, field: 'operations[0].toAmountMinor' })
  })

  it('refuses a malformed account, category or counterparty id', () => {
    expect(parseFinmapBatch(batchBody([op({ accountId: '' })]))).toEqual({ ok: false, field: 'operations[0].accountId' })
    expect(parseFinmapBatch(batchBody([op({ categoryId: 'a.b' })]))).toEqual({ ok: false, field: 'operations[0].categoryId' })
    expect(parseFinmapBatch(batchBody([op({ counterpartyId: 7 })]))).toEqual({ ok: false, field: 'operations[0].counterpartyId' })
  })

  it('accepts a null category and counterparty, and refuses tags over 10 or not ids', () => {
    expect(parseFinmapBatch(batchBody([op({ categoryId: null, counterpartyId: null })])).ok).toBe(true)
    expect(parseFinmapBatch(batchBody([op({ tagIds: Array.from({ length: 10 }, (_, i) => `t${i}`) })])).ok).toBe(true)
    expect(parseFinmapBatch(batchBody([op({ tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) })]))).toEqual({ ok: false, field: 'operations[0].tagIds' })
    expect(parseFinmapBatch(batchBody([op({ tagIds: ['bad/id'] })]))).toEqual({ ok: false, field: 'operations[0].tagIds' })
  })

  it('refuses a description that is not a string or is over 500 characters, and accepts null', () => {
    expect(parseFinmapBatch(batchBody([op({ description: null })])).ok).toBe(true)
    expect(parseFinmapBatch(batchBody([op({ description: 'x'.repeat(500) })])).ok).toBe(true)
    expect(parseFinmapBatch(batchBody([op({ description: 'x'.repeat(501) })]))).toEqual({ ok: false, field: 'operations[0].description' })
    expect(parseFinmapBatch(batchBody([op({ description: 5 })]))).toEqual({ ok: false, field: 'operations[0].description' })
  })

  it('accepts the identity of a transfer the planner makes: two rows of eight strings joined by "+" (17 in all)', () => {
    const identity = [...Array.from({ length: 8 }, (_, i) => `e${i}`), '+', ...Array.from({ length: 8 }, (_, i) => `i${i}`)]
    expect(identity).toHaveLength(17)
    expect(parseFinmapBatch(batchBody([transfer({ identity })])).ok).toBe(true)
    expect(parseFinmapCheck({ operations: [{ accountId: 'acc-main', toAccountId: 'acc-2', identity, ordinal: 0 }] }).ok).toBe(true)
  })

  it('refuses an accrual that is not a pair of days, and more identity strings than 17 or one over 400 characters', () => {
    expect(parseFinmapBatch(batchBody([op({ accrual: { from: '2026-10-01' } })]))).toEqual({ ok: false, field: 'operations[0].accrual' })
    expect(parseFinmapBatch(batchBody([op({ identity: Array.from({ length: 18 }, (_, i) => `s${i}`) })]))).toEqual({ ok: false, field: 'operations[0].identity' })
    expect(parseFinmapBatch(batchBody([op({ identity: ['x'.repeat(401)] })]))).toEqual({ ok: false, field: 'operations[0].identity' })
    expect(parseFinmapBatch(batchBody([op({ identity: 'row' })]))).toEqual({ ok: false, field: 'operations[0].identity' })
  })

  it('refuses an ordinal that is not an integer from 0 to 100000', () => {
    expect(parseFinmapBatch(batchBody([op({ ordinal: 100_000 })])).ok).toBe(true)
    expect(parseFinmapBatch(batchBody([op({ ordinal: 100_001 })]))).toEqual({ ok: false, field: 'operations[0].ordinal' })
    expect(parseFinmapBatch(batchBody([op({ ordinal: -1 })]))).toEqual({ ok: false, field: 'operations[0].ordinal' })
    expect(parseFinmapBatch(batchBody([op({ ordinal: 1.5 })]))).toEqual({ ok: false, field: 'operations[0].ordinal' })
  })
})

describe('parseFinmapCheck', () => {
  const check = (ops: unknown[]): unknown => ({ operations: ops })
  const one = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ accountId: 'acc-main', toAccountId: null, identity: ['2026-10-20'], ordinal: 3, ...over })

  it('reads the keys of operations to look up, transfers included', () => {
    const r = parseFinmapCheck(check([one(), one({ toAccountId: 'acc-2' })]))
    expect(r).toEqual({
      ok: true,
      value: { operations: [{ accountId: 'acc-main', toAccountId: null, identity: ['2026-10-20'], ordinal: 3 }, { accountId: 'acc-main', toAccountId: 'acc-2', identity: ['2026-10-20'], ordinal: 3 }] },
    })
  })

  it('accepts an empty list and refuses more than 500 operations', () => {
    expect(parseFinmapCheck(check([])).ok).toBe(true)
    expect(parseFinmapCheck(check(Array.from({ length: 501 }, () => one())))).toEqual({ ok: false, field: 'operations' })
  })

  it('refuses a body that is not an object, and an operation with a bad field', () => {
    expect(parseFinmapCheck([])).toEqual({ ok: false, field: 'body' })
    expect(parseFinmapCheck(check([one({ accountId: 'a/b' })]))).toEqual({ ok: false, field: 'operations[0].accountId' })
    expect(parseFinmapCheck(check([one({ toAccountId: 5 })]))).toEqual({ ok: false, field: 'operations[0].toAccountId' })
    expect(parseFinmapCheck(check([one({ identity: ['x'.repeat(401)] })]))).toEqual({ ok: false, field: 'operations[0].identity' })
    expect(parseFinmapCheck(check([one({ ordinal: 100_001 })]))).toEqual({ ok: false, field: 'operations[0].ordinal' })
  })
})
