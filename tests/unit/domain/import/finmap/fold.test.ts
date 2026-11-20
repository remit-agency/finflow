import { describe, expect, it } from 'vitest'
import { foldHeader, normKey, normName } from '@/lib/domain/import/finmap/fold'

describe('foldHeader', () => {
  it('folds a plain Polish header to ASCII letters and digits', () => {
    expect(foldHeader('Data płatności')).toBe('dataplatnosci')
  })

  it('maps Cyrillic look-alike letters to their Latin twins', () => {
    // 'Data płatności' with Cyrillic а (а), р (р), о (о), с (с) in place of the Latin letters
    const lookalike = 'Dаtа рłаtnоśсi'
    expect(foldHeader(lookalike)).toBe('dataplatnosci')
    expect(foldHeader(lookalike)).toBe(foldHeader('Data płatności'))
  })

  it('maps capital look-alike letters too', () => {
    // 'KOTA' with Cyrillic К (К), О (О), Т (Т), А (А)
    expect(foldHeader('КОТА')).toBe('kota')
  })

  it('ignores leading whitespace, tabs and line breaks', () => {
    expect(foldHeader('\t\nKontrahent')).toBe('kontrahent')
  })

  it('drops punctuation and the en dash of a period header', () => {
    expect(foldHeader('Okres księgowania – data od')).toBe('okresksiegowaniadataod')
  })
})

describe('normName', () => {
  it('collapses whitespace, tabs and line breaks, and trims', () => {
    expect(normName(' a \t b\n')).toBe('a b')
  })

  it('returns null for an empty or missing cell', () => {
    expect(normName('   ')).toBeNull()
    expect(normName(undefined)).toBeNull()
    expect(normName(null)).toBeNull()
  })

  it('keeps the letters case', () => {
    expect(normName('Domas  Kasa')).toBe('Domas Kasa')
  })
})

describe('normKey', () => {
  it('compares names whitespace-insensitively and case-insensitively', () => {
    expect(normKey('Domas  Kasa')).toBe(normKey('domas kasa'))
  })

  it('does not fold look-alike letters: a Cyrillic name stays a different name', () => {
    expect(normKey('Каsa')).not.toBe(normKey('Kasa'))
  })
})
