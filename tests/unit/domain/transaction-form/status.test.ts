import { describe, expect, it } from 'vitest'
import { effectiveStatus, isFutureDay, paidDay } from '@/lib/domain/transaction-form/status'

const TODAY = '2026-10-28'

describe('isFutureDay', () => {
  it('is true only for a day after today', () => {
    expect(isFutureDay('2026-10-29', TODAY)).toBe(true)
    expect(isFutureDay('2026-10-28', TODAY)).toBe(false)
    expect(isFutureDay('2026-10-27', TODAY)).toBe(false)
  })

  it('is false while the date field is empty or half typed', () => {
    expect(isFutureDay('', TODAY)).toBe(false)
  })
})

describe('effectiveStatus', () => {
  it('a future payment date is always planned, whatever was chosen', () => {
    expect(effectiveStatus('actual', '2026-11-01', TODAY)).toBe('planned')
    expect(effectiveStatus('planned', '2026-11-01', TODAY)).toBe('planned')
  })

  it('today and the past follow the choice', () => {
    expect(effectiveStatus('actual', TODAY, TODAY)).toBe('actual')
    expect(effectiveStatus('planned', TODAY, TODAY)).toBe('planned')
    expect(effectiveStatus('actual', '2026-01-01', TODAY)).toBe('actual')
  })
})

describe('paidDay', () => {
  it('keeps a payment date that is not in the future', () => {
    expect(paidDay('2026-10-20', TODAY)).toBe('2026-10-20')
    expect(paidDay(TODAY, TODAY)).toBe(TODAY)
  })

  it('replaces a future payment date with today (the server refuses an actual operation in the future)', () => {
    expect(paidDay('2026-12-01', TODAY)).toBe(TODAY)
  })
})
