import { describe, expect, it } from 'vitest'
import { ruleMatches } from '@/lib/domain/rules/match'
import type { Rule, RuleOperation } from '@/lib/domain/rules/types'

// Documented behaviour of a text condition: a substring test on the normalised text (case, diacritics and punctuation
// ignored), not a word test. A short word therefore also hits the longer words that contain it. The rule author writes
// the words that are safe to match; the acceptance fixture relies on «BP STACJA» and «ZUS SKŁADKI», not on «BP» and «ZUS».

const fuel = (...values: string[]): Rule => ({
  id: 'r', name: 'Paliwo', type: 'expense', active: true, order: 0, createdAtMs: 0,
  conditions: [{ kind: 'text', op: 'contains', values }], actions: { categoryId: 'cat-fuel' },
})

const row = (bankName: string, remittance: string): RuleOperation => ({
  type: 'expense', accountId: 'acc-main', currency: 'PLN', amountMinor: 900, bankName, remittance,
})

describe('a text condition is a substring test', () => {
  it('a bare «BP» hits the bank fee of PKO BP and a BPH lease (the hazard the fixture avoids)', () => {
    expect(ruleMatches(fuel('BP'), row('PKO BP S.A.', 'Opłata za prowadzenie rachunku'))).toBe(true)
    expect(ruleMatches(fuel('BP'), row('BPH LEASING S.A.', 'Rata leasingu'))).toBe(true)
  })

  it('«BP STACJA» hits the station and not the bank fee or the lease', () => {
    expect(ruleMatches(fuel('BP STACJA'), row('BP-STACJA PALIW 12', 'Zakup paliwa'))).toBe(true)
    expect(ruleMatches(fuel('BP STACJA'), row('PKO BP S.A.', 'Opłata za prowadzenie rachunku'))).toBe(false)
    expect(ruleMatches(fuel('BP STACJA'), row('BPH LEASING S.A.', 'Rata leasingu'))).toBe(false)
  })

  it('a bare «ZUS» hits a shop named ZUSZKA, and «ZUS SKŁADKI» does not', () => {
    const zus = (...values: string[]): Rule => ({ ...fuel(...values), actions: { categoryId: 'cat-zus' } })
    expect(ruleMatches(zus('ZUS'), row('KWIACIARNIA ZUSZKA', 'Kwiaty'))).toBe(true)
    expect(ruleMatches(zus('ZUS SKŁADKI'), row('KWIACIARNIA ZUSZKA', 'Kwiaty'))).toBe(false)
    expect(ruleMatches(zus('ZUS SKŁADKI'), row('ZAKŁAD UBEZPIECZEŃ SPOŁECZNYCH', 'ZUS SKŁADKI 01/2026'))).toBe(true)
  })
})
