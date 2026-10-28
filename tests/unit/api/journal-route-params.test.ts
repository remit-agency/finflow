import { describe, expect, it } from 'vitest'
import { parseLimit } from '@/lib/domain/journal/order'

describe('parseLimit', () => {
  it('defaults to 50 and clamps to 1..100', () => {
    expect(parseLimit(null)).toBe(50)
    expect(parseLimit('')).toBe(50)
    expect(parseLimit('abc')).toBe(50)
    expect(parseLimit('0')).toBe(1)
    expect(parseLimit('-4')).toBe(1)
    expect(parseLimit('30')).toBe(30)
    expect(parseLimit('1000')).toBe(100)
    expect(parseLimit('7.5')).toBe(50)
  })
})
