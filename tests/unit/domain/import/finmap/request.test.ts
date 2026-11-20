import { describe, expect, it } from 'vitest'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { parseFinmapFinish, parseFinmapSetup } from '@/lib/domain/import/finmap/request'

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
