import { describe, expect, it } from 'vitest'
import { crossRate, pickTable, round8, validateRefresh } from '@/lib/server/fx/rates'
import { FxError, type NbpTable } from '@/lib/server/fx/types'

const t = (effectiveDate: string, eur: number): NbpTable => ({
  no: `x/${effectiveDate}`,
  effectiveDate,
  rates: { EUR: eur, USD: 4, UAH: 0.1 },
})
const TABLES = [t('2026-10-22', 4.3), t('2026-10-23', 4.4), t('2026-10-26', 4.5)]

describe('pickTable', () => {
  it('takes the latest table strictly before the day', () => {
    expect(pickTable(TABLES, '2026-10-26')?.effectiveDate).toBe('2026-10-23')
    expect(pickTable(TABLES, '2026-10-24')?.effectiveDate).toBe('2026-10-23')
    expect(pickTable(TABLES, '2026-10-25')?.effectiveDate).toBe('2026-10-23')
  })
  it('a day after the last table takes the last table', () => {
    expect(pickTable(TABLES, '2026-12-01')?.effectiveDate).toBe('2026-10-26')
  })
  it('returns null when nothing is earlier', () => {
    expect(pickTable(TABLES, '2026-10-22')).toBeNull()
    expect(pickTable([], '2026-10-22')).toBeNull()
  })
})

describe('round8', () => {
  it('rounds to 8 decimals', () => {
    expect(round8(1 / 3)).toBe(0.33333333)
    expect(round8(4.4026)).toBe(4.4026)
  })
})

describe('crossRate', () => {
  const table = t('2026-10-26', 4.4)
  it('X -> PLN is mid(X)', () => expect(crossRate(table, 'EUR', 'PLN')).toBe(4.4))
  it('PLN -> X is 1 / mid(X)', () => expect(crossRate(table, 'PLN', 'EUR')).toBeCloseTo(1 / 4.4, 12))
  it('X -> Y is mid(X) / mid(Y)', () => expect(crossRate(table, 'EUR', 'USD')).toBeCloseTo(1.1, 12))
  it('throws unsupported_currency for a code that is not in the table', () => {
    expect(() => crossRate(table, 'XXX', 'PLN')).toThrow(FxError)
    try {
      crossRate(table, 'PLN', 'XXX')
    } catch (e) {
      expect((e as FxError).code).toBe('unsupported_currency')
    }
  })
  it('does not read inherited object keys as currencies', () => {
    expect(() => crossRate(table, 'EUR', 'toString')).toThrow(FxError)
  })
})

describe('validateRefresh', () => {
  const n = (effectiveDate: string, no: string): NbpTable => ({ no, effectiveDate, rates: { EUR: 4 } })
  const OCT = [n('2026-10-15', '199/A/NBP/2026'), n('2026-10-16', '200/A/NBP/2026'), n('2026-10-19', '201/A/NBP/2026')]
  const codeOf = (fn: () => void): string => {
    try {
      fn()
    } catch (e) {
      return e instanceof FxError ? e.code : 'other'
    }
    return 'none'
  }

  it('accepts a reply that keeps every cached day and has no gaps', () => {
    expect(codeOf(() => validateRefresh([...OCT, n('2026-10-20', '202/A/NBP/2026')], OCT, false))).toBe('none')
  })

  it('accepts a first fetch (nothing cached) and an empty unfinished month', () => {
    expect(codeOf(() => validateRefresh(OCT, [], true))).toBe('none')
    expect(codeOf(() => validateRefresh([], [], false))).toBe('none')
  })

  it('rejects an empty reply when the cache holds tables (NBP answered 404 after the fact)', () => {
    expect(codeOf(() => validateRefresh([], OCT, false))).toBe('provider_unavailable')
  })

  it('rejects a reply that lost a cached day', () => {
    expect(codeOf(() => validateRefresh([OCT[0], OCT[2]], OCT, false))).toBe('provider_unavailable')
  })

  it('rejects an empty finished month', () => {
    expect(codeOf(() => validateRefresh([], [], true))).toBe('provider_unavailable')
  })

  it('rejects a gap in the table numbers of one year', () => {
    expect(codeOf(() => validateRefresh([OCT[0], OCT[2]], [], false))).toBe('provider_unavailable')
  })

  it('ignores an unparsable number and a change of year', () => {
    expect(codeOf(() => validateRefresh([n('2026-10-15', 'garbage'), n('2026-10-16', '200/A/NBP/2026')], [], false))).toBe('none')
    expect(codeOf(() => validateRefresh([n('2025-12-31', '251/A/NBP/2025'), n('2026-01-02', '1/A/NBP/2026')], [], true))).toBe('none')
  })
})
