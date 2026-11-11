import { describe, expect, it, vi } from 'vitest'
import { createFlagStore } from '@/lib/shell/flag-store'
import type { FlagStorage } from '@/lib/shell/sidebar-store'

function memoryStorage(initial: Record<string, string> = {}): FlagStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('createFlagStore', () => {
  it('starts as the fallback, on the server and with nothing stored', () => {
    const store = createFlagStore('k', false, () => memoryStorage())
    expect(store.getSnapshot()).toBe(false)
    expect(store.getServerSnapshot()).toBe(false)
    expect(createFlagStore('k', true, () => memoryStorage()).getServerSnapshot()).toBe(true)
  })

  it('reads what an earlier visit stored, and writes what is set', () => {
    const storage = memoryStorage({ k: '1' })
    const store = createFlagStore('k', false, () => storage)
    expect(store.getSnapshot()).toBe(true)
    store.set(false)
    expect(storage.data.k).toBe('0')
    expect(store.getSnapshot()).toBe(false)
  })

  it('an unknown stored value is the fallback', () => {
    expect(createFlagStore('k', true, () => memoryStorage({ k: 'maybe' })).getSnapshot()).toBe(true)
  })

  it('tells its subscribers on a change, and not after they leave', () => {
    const store = createFlagStore('k', false, () => memoryStorage())
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.set(true)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    store.set(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a throwing or missing storage never breaks it: the flag lives in memory for the page session', () => {
    const broken: FlagStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const store = createFlagStore('k', false, () => broken)
    expect(store.getSnapshot()).toBe(false)
    store.set(true)
    expect(store.getSnapshot()).toBe(true)
    const none = createFlagStore('k', false, () => null)
    none.set(true)
    expect(none.getSnapshot()).toBe(true)
  })
})
