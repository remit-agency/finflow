import { describe, expect, it } from 'vitest'
import { addDays } from '@/lib/domain/ledger/days'
import { findTransferPairs, parseCandidate } from '@/lib/domain/transfers/pairs'
import type { Candidate } from '@/lib/domain/transfers/types'
import { encodeVersion, parseVersion } from '@/lib/domain/transfers/version'

let n = 0
/** A bank operation as the suggestions read sees it. */
function cand(type: 'income' | 'expense', accountId: string, amountMinor: number, paymentDate: string, extra: Partial<Candidate> = {}): Candidate {
  n++
  return {
    id: `bk_${String(n).padStart(32, '0')}`, version: `1790000000.${String(n).padStart(9, '0')}`, type, status: 'actual',
    isRecurring: false, accountId, amountMinor, currency: 'PLN', paymentDate,
    bank: { accountRef: `ba-${accountId}`, counterpartyName: 'Własne', remittance: `Przelew ${n}` }, ...extra,
  }
}

describe('parseCandidate', () => {
  it('reads the selected fields of a v2 bank operation and its version', () => {
    const data = {
      schemaVersion: 2, type: 'expense', status: 'actual', isRecurring: false, accountId: 'mil', amountMinor: 500, currency: 'PLN',
      paymentDate: '2026-10-20', source: 'bank', bank: { accountRef: 'ba1', remittance: 'Przelew' },
    }
    expect(parseCandidate('bk_1', data, '1.000000002')).toEqual({
      id: 'bk_1', version: '1.000000002', type: 'expense', status: 'actual', isRecurring: false, accountId: 'mil', amountMinor: 500,
      currency: 'PLN', paymentDate: '2026-10-20', bank: { accountRef: 'ba1', remittance: 'Przelew' },
    })
    expect(parseCandidate('m1', { ...data, source: undefined }, '1.000000002')?.bank).toBeUndefined()
  })

  it('a document of another schema or with a broken field is no candidate', () => {
    const data = { schemaVersion: 2, type: 'expense', status: 'actual', isRecurring: false, accountId: 'mil', amountMinor: 500, currency: 'PLN', paymentDate: '2026-10-20' }
    expect(parseCandidate('x', { ...data, schemaVersion: 1 }, '1.000000000')).toBeNull()
    expect(parseCandidate('x', { ...data, amountMinor: -5 }, '1.000000000')).toBeNull()
    expect(parseCandidate('x', { ...data, paymentDate: '20.10.2026' }, '1.000000000')).toBeNull()
    expect(parseCandidate('x', { ...data, type: 'gift' }, '1.000000000')).toBeNull()
  })
})

describe('findTransferPairs', () => {
  it('pairs a bank expense and a bank income of two accounts: same amount and currency, at most 3 days apart', () => {
    const out = cand('expense', 'mil', 100_000, '2026-10-12')
    const inc = cand('income', 'mono', 100_000, '2026-10-15')
    expect(findTransferPairs([out, inc])).toEqual({
      pairs: [{
        from: { id: out.id, version: out.version, accountId: 'mil', amountMinor: 100_000, currency: 'PLN', paymentDate: '2026-10-12', counterpartyName: 'Własne', remittance: out.bank?.remittance },
        to: { id: inc.id, version: inc.version, accountId: 'mono', amountMinor: 100_000, currency: 'PLN', paymentDate: '2026-10-15', counterpartyName: 'Własne', remittance: inc.bank?.remittance },
      }],
      total: 1,
      ambiguous: 0,
    })
  })

  it.each([
    ['4 days apart', cand('income', 'mono', 100_000, '2026-10-16')],
    ['the same account', cand('income', 'mil', 100_000, '2026-10-12')],
    ['another currency', cand('income', 'eur', 100_000, '2026-10-12', { currency: 'EUR' })],
    ['another amount', cand('income', 'mono', 99_999, '2026-10-12')],
    ['a manual income', cand('income', 'mono', 100_000, '2026-10-12', { bank: undefined })],
    ['a planned income', cand('income', 'mono', 100_000, '2026-10-12', { status: 'planned' })],
    ['a recurring income', cand('income', 'mono', 100_000, '2026-10-12', { isRecurring: true })],
    ['a transfer', cand('income', 'mono', 100_000, '2026-10-12', { type: 'transfer' })],
  ])('offers nothing for %s', (_name, other) => {
    expect(findTransferPairs([cand('expense', 'mil', 100_000, '2026-10-12'), other]).pairs).toEqual([])
  })

  it('a side with two candidates is not offered and counts as ambiguous', () => {
    const out = cand('expense', 'mil', 70_000, '2026-10-20')
    const a = cand('income', 'mono', 70_000, '2026-10-20')
    const b = cand('income', 'cash', 70_000, '2026-10-21')
    expect(findTransferPairs([out, a, b])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
    const out2 = cand('expense', 'cash', 70_000, '2026-10-19')
    // Two expenses for one income: neither the expense with two incomes nor the income with two expenses is offered.
    expect(findTransferPairs([out, out2, a])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
  })

  it('offers the newest pairs first, at most 50, and says how many there are', () => {
    const cands: Candidate[] = []
    for (let i = 0; i < 60; i++) {
      const day = addDays('2026-10-26', -i)
      cands.push(cand('expense', 'mil', 1_000 + i, day), cand('income', 'mono', 1_000 + i, day))
    }
    const { pairs, total } = findTransferPairs(cands)
    expect(total).toBe(60)
    expect(pairs).toHaveLength(50)
    expect(pairs[0].from.paymentDate).toBe('2026-10-26')
    expect(pairs[49].from.paymentDate).toBe(addDays('2026-10-26', -49))
  })
})

describe('versions', () => {
  it('round-trip seconds and nanoseconds; anything else is no version', () => {
    expect(encodeVersion({ seconds: 1790000000, nanoseconds: 5 })).toBe('1790000000.000000005')
    expect(parseVersion('1790000000.000000005')).toEqual({ seconds: 1790000000, nanoseconds: 5 })
    for (const bad of ['1790000000', '1790000000.5', 'x.000000005', '', 5, null]) expect(parseVersion(bad)).toBeNull()
  })
})
