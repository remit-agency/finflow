import { describe, expect, it } from 'vitest'
import { bankDifference, fittedOpening } from '@/lib/domain/banking/fit'

describe('balance fit', () => {
  it('sets the opening so that balance = bank balance after the operations are in', () => {
    // balance 500 = opening 100 + net 400; the bank says 1000 -> opening must be 600
    expect(fittedOpening(1000, 500, 100)).toBe(600)
    // no operations: opening = bank balance
    expect(fittedOpening(7777, 0, 0)).toBe(7777)
    // negative bank balance (overdraft)
    expect(fittedOpening(-2500, -500, 0)).toBe(-2000)
  })
  it('difference is FinFlow minus bank', () => {
    expect(bankDifference(1000, 1050)).toBe(50)
    expect(bankDifference(1000, 940)).toBe(-60)
  })
})
