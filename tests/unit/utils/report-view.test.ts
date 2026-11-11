import { describe, expect, it } from 'vitest'
import { periodKeyLabel } from '@/lib/utils/report-view'

describe('periodKeyLabel', () => {
  it('a month key as a month label, a day key as a day label, in the UI language', () => {
    expect(periodKeyLabel('2026-10', 'uk')).toBe('Жов 26')
    expect(periodKeyLabel('2026-10', 'en')).toBe('Oct 2026')
    expect(periodKeyLabel('2026-10-19', 'pl')).toBe('19 paź')
    expect(periodKeyLabel('2026-10-19', 'en')).toBe('19 Oct')
  })
})
