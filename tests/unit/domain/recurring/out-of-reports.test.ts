import { describe, expect, it } from 'vitest'
import { changeSet } from '@/lib/domain/ledger/change'
import { balanceEffects, datedEffects } from '@/lib/domain/ledger/effects'
import { contributions } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { isListed } from '@/lib/utils/journal'

const plan: LedgerTransaction = {
  id: 'pl_ser1_2026-11-10', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, currency: 'EUR',
  paymentDate: '2026-11-10', accrual: { mode: 'date', date: '2026-11-10' }, isRecurring: false, tags: ['vat'], fileUrls: [],
  categoryId: 'rent', seriesId: 'ser1', occurrence: '2026-11-10', estimated: true, excluded: true,
}

describe('a planned occurrence stays out of balances, rollups, reports and the Calendar (S11)', () => {
  it('moves no account and adds to no rollup, even in another currency without base amounts', () => {
    expect(datedEffects(plan)).toEqual([])
    expect(balanceEffects(plan)).toEqual({})
    expect([...contributions(plan, 'PLN')]).toEqual([])
    const change = changeSet(null, plan, 'PLN')
    expect(change.balanceDeltas).toEqual({})
    expect([...change.rollupDeltas]).toEqual([])
  })

  it('is listed by the journal only: the reports and the Calendar read without planned operations', () => {
    const ui = toUiTransaction('org1', plan)
    expect(isListed(ui, false)).toBe(false)
    expect(isListed(ui, true)).toBe(true)
  })
})
