import { describe, expect, it, vi } from 'vitest'
import type { MonthDoc } from '@/lib/server/fx/types'
import { readOnlyFxStore } from '@/scripts/lib/readonly-fx-store'

const doc: MonthDoc = { month: '2026-10', tables: [], fetchedAt: 1, fetchedDay: '2026-10-27', complete: false }

describe('readOnlyFxStore', () => {
  it('reads through to the real store and never writes to it', async () => {
    const real = { get: vi.fn(async () => doc), set: vi.fn(async () => undefined) }
    const store = readOnlyFxStore(real)
    expect(await store.get('2026-10')).toBe(doc)
    expect(real.get).toHaveBeenCalledWith('2026-10')
    await store.set(doc)
    expect(real.set).not.toHaveBeenCalled()
  })

  it('passes a read error through (the resolver treats it as a cache miss)', async () => {
    const store = readOnlyFxStore({ get: async () => { throw new Error('boom') }, set: async () => undefined })
    await expect(store.get('2026-10')).rejects.toThrow('boom')
  })
})
