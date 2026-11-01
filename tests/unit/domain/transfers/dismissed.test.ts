import { describe, expect, it } from 'vitest'
import { DISMISSED_PREFIX, MAX_DISMISSED, pairKeyOf, readDismissed, withDismissed, writeDismissed, type KeyValueStorage } from '@/lib/domain/transfers/dismissed'

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}
const broken: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('the pairs turned down in this browser', () => {
  it('are kept per company', () => {
    const storage = memory()
    expect(writeDismissed(storage, 'org1', [pairKeyOf('a', 'b')])).toBe(true)
    expect(readDismissed(storage, 'org1')).toEqual(['a|b'])
    expect(readDismissed(storage, 'org2')).toEqual([])
    expect(storage.data.has(`${DISMISSED_PREFIX}org1`)).toBe(true)
  })

  it('missing, blocked or foreign storage reads as nothing and a write says it failed', () => {
    const storage = memory()
    storage.data.set(`${DISMISSED_PREFIX}org1`, '{"not":"a list"}')
    expect(readDismissed(storage, 'org1')).toEqual([])
    storage.data.set(`${DISMISSED_PREFIX}org1`, '[1, "a|b"]')
    expect(readDismissed(storage, 'org1')).toEqual(['a|b'])
    expect(readDismissed(broken, 'org1')).toEqual([])
    expect(readDismissed(null, 'org1')).toEqual([])
    expect(writeDismissed(broken, 'org1', ['a|b'])).toBe(false)
    expect(writeDismissed(null, 'org1', ['a|b'])).toBe(false)
  })

  it('adds each key once, the newest last, and forgets the oldest beyond the limit', () => {
    expect(withDismissed(['a|b', 'c|d'], ['a|b', 'e|f', 'e|f'])).toEqual(['c|d', 'a|b', 'e|f'])
    const many = Array.from({ length: MAX_DISMISSED }, (_, i) => `k${i}|x`)
    const next = withDismissed(many, ['new|x'])
    expect(next).toHaveLength(MAX_DISMISSED)
    expect(next[0]).toBe('k1|x')
    expect(next[MAX_DISMISSED - 1]).toBe('new|x')
  })
})
