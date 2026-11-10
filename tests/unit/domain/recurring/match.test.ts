import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { canMatch, carriedOf, findPlanMatches, parseBankSide, parsePlanSide, withCarried, withoutCarried } from '@/lib/domain/recurring/match'
import type { BankSide, PlanSide } from '@/lib/domain/recurring/types'

const K = (n: number): string => `bk_${String(n).padStart(32, '0')}`
const plan = (id: string, paymentDate: string, over: Partial<PlanSide> = {}): PlanSide => ({
  id, version: '1.000000001', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate, seriesId: 'ser1', occurrence: paymentDate, estimated: false, ...over,
})
const bank = (id: string, paymentDate: string, over: Partial<BankSide> = {}): BankSide => ({
  id, version: '1.000000002', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate, ...over,
})

describe('canMatch', () => {
  it('the same kind and account, the exact amount, from 3 days before to 10 days after the plan', () => {
    const p = plan('pl_ser1_2026-11-10', '2026-11-10')
    expect(canMatch(p, bank(K(1), '2026-11-07'))).toBe(true)
    expect(canMatch(p, bank(K(1), '2026-11-20'))).toBe(true)
    expect(canMatch(p, bank(K(1), '2026-11-06'))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-21'))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-10', { amountMinor: 250_001 }))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-10', { type: 'income' }))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-10', { accountId: 'mono' }))).toBe(false)
  })

  it('an estimate compares the counterparty instead of the amount; without a counterparty it never matches', () => {
    const p = plan('pl_zus_2026-11-16', '2026-11-16', { estimated: true, counterpartyId: 'system_zus' })
    expect(canMatch(p, bank(K(1), '2026-11-17', { amountMinor: 151_234, counterpartyId: 'system_zus' }))).toBe(true)
    expect(canMatch(p, bank(K(1), '2026-11-17', { amountMinor: 151_234 }))).toBe(false)
    expect(canMatch({ ...p, counterpartyId: undefined }, bank(K(1), '2026-11-17', { counterpartyId: 'system_zus' }))).toBe(false)
  })
})

describe('findPlanMatches', () => {
  it('offers a pair only when each side has exactly one candidate', () => {
    const a = plan('pl_ser1_2026-11-10', '2026-11-10')
    const b = plan('pl_ser2_2026-11-12', '2026-11-12', { seriesId: 'ser2' })
    expect(findPlanMatches([a, b], [bank(K(1), '2026-11-11')])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
    expect(findPlanMatches([a], [bank(K(1), '2026-11-11'), bank(K(2), '2026-11-12')])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
    expect(findPlanMatches([a], [bank(K(1), '2026-11-11')])).toEqual({ pairs: [{ plan: a, bank: bank(K(1), '2026-11-11') }], total: 1, ambiguous: 0 })
  })

  it('newest first by the bank day, at most the cap', () => {
    const plans = [0, 1, 2].map((i) => plan(`pl_ser${i}_2026-11-1${i}`, `2026-11-1${i}`, { seriesId: `ser${i}`, amountMinor: 1000 + i }))
    const banks = plans.map((p, i) => bank(K(i), p.paymentDate, { amountMinor: p.amountMinor }))
    const r = findPlanMatches(plans, banks, 2)
    expect(r.total).toBe(3)
    expect(r.pairs.map((m) => m.bank.paymentDate)).toEqual(['2026-11-12', '2026-11-11'])
  })
})

describe('parsing the sides', () => {
  const doc = {
    schemaVersion: 2, type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-10',
    seriesId: 'ser1', occurrence: '2026-11-10', counterpartyId: 'cp1',
  }

  it('a plan side is a planned income or expense of a series that nobody changed by hand', () => {
    expect(parsePlanSide('pl_ser1_2026-11-10', doc, 'v')).toEqual({
      id: 'pl_ser1_2026-11-10', version: 'v', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-10',
      seriesId: 'ser1', occurrence: '2026-11-10', estimated: false, counterpartyId: 'cp1',
    })
    expect(parsePlanSide('x', { ...doc, manual: true }, 'v')).toBeNull()
    expect(parsePlanSide('x', { ...doc, seriesId: undefined }, 'v')).toBeNull()
    expect(parsePlanSide('x', { ...doc, status: 'actual' }, 'v')).toBeNull()
  })

  it('a bank side is an actual bank income or expense that pays no plan yet', () => {
    const b = {
      schemaVersion: 2, type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-11',
      source: 'bank', bank: { accountRef: 'ba', remittance: 'Czynsz XI', counterpartyName: 'Landlord' }, counterpartyId: 'cp1',
    }
    expect(parseBankSide(K(1), b, 'v')).toEqual({
      id: K(1), version: 'v', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-11',
      counterpartyId: 'cp1', counterpartyName: 'Landlord', remittance: 'Czynsz XI',
    })
    expect(parseBankSide(K(1), { ...b, seriesId: 'ser1' }, 'v')).toBeNull()
    expect(parseBankSide('manual-12345678', b, 'v')).toBeNull()
    expect(parseBankSide(K(1), { ...b, source: undefined }, 'v')).toBeNull()
    expect(parseBankSide(K(1), { ...b, type: 'transfer' }, 'v')).toBeNull()
  })
})

describe('what a match carries over and what its undo takes back', () => {
  const p: LedgerTransaction = {
    id: 'pl_ser1_2026-11-10', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-10',
    accrual: { mode: 'date', date: '2026-11-10' }, isRecurring: false, tags: ['t1'], fileUrls: [], categoryId: 'rent', counterpartyId: 'cp1',
    description: 'Lokal', seriesId: 'ser1', occurrence: '2026-11-10',
  }
  const b: LedgerTransaction = {
    id: K(1), type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-11',
    accrual: { mode: 'date', date: '2026-11-11' }, isRecurring: false, tags: [], fileUrls: [], description: 'Czynsz XI', counterpartyId: 'cp9',
    bank: { accountRef: 'ba' }, autoRules: [{ id: 'r1', name: 'Landlord' }],
  }

  it('only the fields the bank operation lacks', () => {
    expect(carriedOf(p, b)).toEqual({ categoryId: 'rent', tags: ['t1'] })
  })

  it('the undo takes off the link and what is still as carried; the rules trace stays', () => {
    const linked: LedgerTransaction = { ...withCarried(b, { categoryId: 'rent', tags: ['t1'] }), seriesId: 'ser1', occurrence: '2026-11-10' }
    expect(linked).toMatchObject({ categoryId: 'rent', tags: ['t1'], description: 'Czynsz XI', counterpartyId: 'cp9', autoRules: [{ id: 'r1', name: 'Landlord' }] })
    expect(withoutCarried(linked, { categoryId: 'rent', tags: ['t1'] })).toEqual(b)
    expect(withoutCarried({ ...linked, categoryId: 'office' }, { categoryId: 'rent', tags: ['t1'] })).toEqual({ ...b, categoryId: 'office' })
  })
})
