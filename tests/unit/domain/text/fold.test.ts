import { describe, expect, it } from 'vitest'
import { foldDiacritics } from '@/lib/domain/text/fold'

describe('foldDiacritics', () => {
  it('drops the Polish diacritics, ł and Ł included, and keeps the case', () => {
    expect(foldDiacritics('Zażółć gęślą jaźń')).toBe('Zazolc gesla jazn')
    expect(foldDiacritics('ŁÓDŹ łódź')).toBe('LODZ lodz')
  })

  it('keeps Cyrillic letters as they are and drops a stray stress mark', () => {
    expect(foldDiacritics('й ї и')).toBe('й ї и')
    expect(foldDiacritics('за́мок')).toBe('замок')
  })

  it('leaves digits, spaces and punctuation alone', () => {
    expect(foldDiacritics('FV/12/2026 – SP. Z O.O.')).toBe('FV/12/2026 – SP. Z O.O.')
  })
})
