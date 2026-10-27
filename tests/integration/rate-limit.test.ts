import { beforeEach, describe, expect, it } from 'vitest'
import { consumeRateLimit, type RateWindow } from '@/lib/server/rate-limit'
import { clearFirestore, testDb } from './helpers'

const WINDOWS: readonly RateWindow[] = [
  { name: 'm', seconds: 60, max: 3 },
  { name: 'h', seconds: 3600, max: 5 },
]
const T0 = new Date('2026-10-27T10:00:10Z')
const plus = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

beforeEach(clearFirestore)

describe('consumeRateLimit', () => {
  it('allows up to max in the narrowest window, then refuses', async () => {
    const db = testDb()
    const results = []
    for (let i = 0; i < 5; i++) results.push(await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0))
    expect(results).toEqual([true, true, true, false, false])
  })

  it('a new minute resets the minute counter but not the hour counter', async () => {
    const db = testDb()
    for (let i = 0; i < 3; i++) expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)).toBe(true)
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, plus(60))).toBe(true) // 4th overall
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, plus(61))).toBe(true) // 5th overall
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, plus(62))).toBe(false) // hour max 5
  })

  it('counts per key', async () => {
    const db = testDb()
    for (let i = 0; i < 3; i++) await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)).toBe(false)
    expect(await consumeRateLimit(db, 'lookup_u2', WINDOWS, T0)).toBe(true)
  })

  it('a refused call counts nothing', async () => {
    const db = testDb()
    for (let i = 0; i < 6; i++) await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)
    const minute = await db.doc(`rateLimits/lookup_u1_m_${Math.floor(T0.getTime() / 1000 / 60)}`).get()
    expect(minute.get('count')).toBe(3)
  })

  it('parallel calls never get more than max through', async () => {
    const db = testDb()
    // allSettled: under heavy contention the emulator may abort a few transactions; those are neither allowed nor counted.
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumeRateLimit(db, 'lookup_u3', WINDOWS, T0)))
    const allowed = results.filter((r) => r.status === 'fulfilled' && r.value).length
    expect(allowed).toBeLessThanOrEqual(3)
    if (results.every((r) => r.status === 'fulfilled')) expect(allowed).toBe(3)
  })
})
