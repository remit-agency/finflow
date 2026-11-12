import { describe, expect, it, vi } from 'vitest'
import { createChoiceStore } from '@/lib/shell/choice-store'
import type { FlagStorage } from '@/lib/shell/sidebar-store'

const CHOICES = ['month', 'half', 'all'] as const

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

describe('createChoiceStore', () => {
  it('starts as the fallback, on the server and with nothing stored', () => {
    const store = createChoiceStore('k', 'month', CHOICES, () => memoryStorage())
    expect(store.getSnapshot()).toBe('month')
    expect(store.getServerSnapshot()).toBe('month')
  })

  it('reads what an earlier visit stored, and writes what is set', () => {
    const storage = memoryStorage({ k: 'half' })
    const store = createChoiceStore('k', 'month', CHOICES, () => storage)
    expect(store.getSnapshot()).toBe('half')
    store.set('all')
    expect(storage.data.k).toBe('all')
    expect(store.getSnapshot()).toBe('all')
  })

  it('a stored value that is not a choice is the fallback', () => {
    expect(createChoiceStore('k', 'month', CHOICES, () => memoryStorage({ k: 'week' })).getSnapshot()).toBe('month')
  })

  it('tells its subscribers on a change, and not after they leave', () => {
    const store = createChoiceStore('k', 'month', CHOICES, () => memoryStorage())
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.set('half')
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    store.set('all')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the choice for the page session when storage throws', () => {
    const broken: FlagStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const store = createChoiceStore('k', 'month', CHOICES, () => broken)
    expect(store.getSnapshot()).toBe('month')
    store.set('all')
    expect(store.getSnapshot()).toBe('all')
  })
})
