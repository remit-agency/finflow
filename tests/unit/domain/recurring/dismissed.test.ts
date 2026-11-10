import { describe, expect, it } from 'vitest'
import { PLAN_DISMISSED_PREFIX, readPlanDismissed, writePlanDismissed } from '@/lib/domain/recurring/dismissed'
import { DISMISSED_PREFIX, readDismissed } from '@/lib/domain/transfers/dismissed'

function memory(): Storage {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as unknown as Storage
}

describe('turned-down plan matches (this browser only)', () => {
  it('live under their own key, apart from the turned-down transfers', () => {
    const storage = memory()
    expect(writePlanDismissed(storage, 'org1', ['pl_a_2026-11-10|bk_1'])).toBe(true)
    expect(readPlanDismissed(storage, 'org1')).toEqual(['pl_a_2026-11-10|bk_1'])
    expect(storage.getItem(`${PLAN_DISMISSED_PREFIX}org1`)).not.toBeNull()
    expect(readDismissed(storage, 'org1')).toEqual([])
    expect(storage.getItem(`${DISMISSED_PREFIX}org1`)).toBeNull()
  })

  it('a missing or throwing storage keeps nothing and never throws', () => {
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } as unknown as Storage
    expect(readPlanDismissed(null, 'org1')).toEqual([])
    expect(readPlanDismissed(throwing, 'org1')).toEqual([])
    expect(writePlanDismissed(throwing, 'org1', ['k'])).toBe(false)
  })
})
