import { describe, expect, it } from 'vitest'
import { isOverdue, parsePlannedRow } from '@/lib/domain/recurring/rows'

describe('planned rows (S11)', () => {
  it('a planned operation of a day before today is overdue; today and actual ones are not', () => {
    expect(isOverdue({ status: 'planned', paymentDate: '2026-11-09' }, '2026-11-10')).toBe(true)
    expect(isOverdue({ status: 'planned', paymentDate: '2026-11-10' }, '2026-11-10')).toBe(false)
    expect(isOverdue({ status: 'actual', paymentDate: '2026-11-01' }, '2026-11-10')).toBe(false)
  })

  it('reads a selected planned operation, with its series link and flags', () => {
    const data = { schemaVersion: 2, type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 150_000, currency: 'PLN', paymentDate: '2026-11-16', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true }
    expect(parsePlannedRow('pl_ser1_2026-11-15', data)).toEqual({
      id: 'pl_ser1_2026-11-15', type: 'expense', accountId: 'mil', amountMinor: 150_000, currency: 'PLN', paymentDate: '2026-11-16',
      seriesId: 'ser1', occurrence: '2026-11-15', estimated: true, manual: false,
    })
    expect(parsePlannedRow('x', { ...data, status: 'actual' })).toBeNull()
    expect(parsePlannedRow('x', { ...data, amountMinor: 0 })).toBeNull()
  })
})
