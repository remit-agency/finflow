import { describe, expect, it } from 'vitest'
import {
  accrualError,
  accrualFor,
  accrualStateOf,
  emptyAccrual,
  type AccrualState,
} from '@/lib/domain/transaction-form/accrual'

const PAY = '2026-10-20'

const on = (over: Partial<AccrualState>): AccrualState => ({ ...emptyAccrual(PAY), on: true, ...over })

describe('emptyAccrual', () => {
  it('is off, follows the payment date, and starts a period on it', () => {
    expect(emptyAccrual(PAY)).toEqual({ on: false, mode: 'date', date: null, from: PAY, to: PAY })
  })
})

describe('accrualFor', () => {
  it('sends nothing while the switch is off (the server then follows the payment date)', () => {
    expect(accrualFor(emptyAccrual(PAY), PAY)).toBeUndefined()
  })

  it('a single date that was not touched follows the payment date', () => {
    expect(accrualFor(on({ mode: 'date' }), '2026-10-25')).toEqual({ mode: 'date', date: '2026-10-25' })
  })

  it('a single date that was typed wins over the payment date', () => {
    expect(accrualFor(on({ mode: 'date', date: '2026-10-01' }), PAY)).toEqual({ mode: 'date', date: '2026-10-01' })
  })

  it('a period sends both ends', () => {
    expect(accrualFor(on({ mode: 'period', from: '2026-10-01', to: '2026-12-31' }), PAY)).toEqual({
      mode: 'period',
      from: '2026-10-01',
      to: '2026-12-31',
    })
  })
})

describe('accrualError', () => {
  it('is null while the switch is off, whatever the hidden fields hold', () => {
    expect(accrualError({ ...emptyAccrual(PAY), from: 'x', to: 'y' }, PAY)).toBeNull()
  })

  it('accepts a valid date and a valid period, including a one-day period', () => {
    expect(accrualError(on({ mode: 'date', date: '2026-10-01' }), PAY)).toBeNull()
    expect(accrualError(on({ mode: 'period', from: '2026-10-01', to: '2026-10-01' }), PAY)).toBeNull()
  })

  it('refuses a date that is not a day or is before 2000', () => {
    expect(accrualError(on({ mode: 'date', date: '2026-13-01' }), PAY)).toBe('accrualDate')
    expect(accrualError(on({ mode: 'date', date: '1999-12-31' }), PAY)).toBe('accrualDate')
    expect(accrualError(on({ mode: 'date', date: '' }), PAY)).toBe('accrualDate')
  })

  it('names the end of a period that is missing or invalid', () => {
    expect(accrualError(on({ mode: 'period', from: '', to: '2026-12-31' }), PAY)).toBe('accrualFrom')
    expect(accrualError(on({ mode: 'period', from: '2026-10-01', to: '' }), PAY)).toBe('accrualTo')
  })

  it('refuses a period that ends before it starts', () => {
    expect(accrualError(on({ mode: 'period', from: '2026-12-31', to: '2026-10-01' }), PAY)).toBe('accrualOrder')
  })
})

describe('accrualStateOf (a stored operation)', () => {
  it('a date equal to the payment date is the same as no own accrual: the switch is off', () => {
    expect(accrualStateOf({ mode: 'date', date: PAY }, PAY)).toEqual(emptyAccrual(PAY))
  })

  it('a different date turns the switch on with that date', () => {
    expect(accrualStateOf({ mode: 'date', date: '2026-10-01' }, PAY)).toEqual({
      on: true,
      mode: 'date',
      date: '2026-10-01',
      from: PAY,
      to: PAY,
    })
  })

  it('a period turns the switch on in period mode', () => {
    expect(accrualStateOf({ mode: 'period', from: '2026-10-01', to: '2026-12-31' }, PAY)).toEqual({
      on: true,
      mode: 'period',
      date: null,
      from: '2026-10-01',
      to: '2026-12-31',
    })
  })
})
