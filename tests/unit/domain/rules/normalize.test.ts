import { describe, expect, it } from 'vitest'
import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import { normalizeRuleText } from '@/lib/domain/rules/normalize'

describe('normalizeRuleText', () => {
  it.each([
    ['ZUS SKŁADKI', 'zus skladki'],
    ['Opłata za prowadzenie rachunku', 'oplata za prowadzenie rachunku'],
    ['ŻABKA Z5001', 'zabka z5001'],
    ['  BP-STACJA   PALIW  ', 'bp stacja paliw'],
    ['Przelew od ALFA SP. Z O.O.; FV/12/2026', 'przelew od alfa sp z o o fv 12 2026'],
    ['T-Mobile*Polska', 't mobile polska'],
    ['!!!', ''],
    ['', ''],
  ])('%j -> %j', (text, expected) => {
    expect(normalizeRuleText(text)).toBe(expected)
  })

  it('compares like the counterparty name key, with spaces instead of underscores', () => {
    expect(normalizeRuleText('Łódź Sp. z o.o.')).toBe(nameKeyText('Łódź Sp. z o.o.').replace(/_/g, ' '))
  })
})
