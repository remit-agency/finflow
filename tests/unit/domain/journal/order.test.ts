// tests/unit/domain/journal/order.test.ts
import { describe, expect, it } from 'vitest'
import { compareKeys, decodeCursor, encodeCursor, type JournalKey } from '@/lib/domain/journal/order'

const key = (paymentDate: string, s: number, n: number, id: string): JournalKey => ({ paymentDate, createdAtS: s, createdAtN: n, id })

describe('compareKeys', () => {
  it('lists the newer payment date first', () => {
    expect(compareKeys(key('2026-10-02', 0, 0, 'a'), key('2026-10-01', 9, 9, 'z'))).toBeLessThan(0)
  })
  it('within a day lists the later created first, down to the nanosecond', () => {
    expect(compareKeys(key('2026-10-01', 5, 0, 'a'), key('2026-10-01', 4, 0, 'z'))).toBeLessThan(0)
    expect(compareKeys(key('2026-10-01', 5, 7, 'a'), key('2026-10-01', 5, 6, 'z'))).toBeLessThan(0)
  })
  it('breaks the last tie by id, descending', () => {
    expect(compareKeys(key('2026-10-01', 5, 0, 'b'), key('2026-10-01', 5, 0, 'a'))).toBeLessThan(0)
    expect(compareKeys(key('2026-10-01', 5, 0, 'a'), key('2026-10-01', 5, 0, 'a'))).toBe(0)
  })
})

describe('cursor', () => {
  it('round-trips', () => {
    const k = key('2026-10-01', 1_790_000_000, 123_456_000, 'abc_DEF-1')
    expect(decodeCursor(encodeCursor(k))).toEqual(k)
  })
  it('rejects anything that is not a cursor', () => {
    for (const bad of ['', 'x', '%%%', btoa('[]'), btoa('["2026-13-01",1,1,"a"]'), btoa('["2026-10-01",-1,1,"a"]'), btoa('["2026-10-01",1,1,"a/b"]')]) {
      expect(decodeCursor(bad)).toBeNull()
    }
  })
})
