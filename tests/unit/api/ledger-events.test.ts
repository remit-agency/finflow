import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyLedgerChanged, onLedgerChanged } from '@/lib/api/ledger-events'

afterEach(() => vi.unstubAllGlobals())

describe('ledger events', () => {
  it('calls a subscriber on notify and not after it unsubscribed', () => {
    vi.stubGlobal('window', new EventTarget())
    const cb = vi.fn()
    const off = onLedgerChanged(cb)
    notifyLedgerChanged()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    notifyLedgerChanged()
    expect(cb).toHaveBeenCalledTimes(1)
  })
  it('does nothing without a window (server render)', () => {
    expect(() => notifyLedgerChanged()).not.toThrow()
  })
})
