import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyLedgerChanged, onLedgerChanged, withoutNotifications } from '@/lib/api/ledger-events'

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
  describe('withoutNotifications', () => {
    it('holds back every notification inside and sends one when it settles', async () => {
      vi.stubGlobal('window', new EventTarget())
      const cb = vi.fn()
      const off = onLedgerChanged(cb)
      const result = await withoutNotifications(async () => {
        notifyLedgerChanged()
        await Promise.resolve()
        notifyLedgerChanged()
        expect(cb).not.toHaveBeenCalled()
        return 'done'
      })
      expect(result).toBe('done')
      expect(cb).toHaveBeenCalledTimes(1)
      notifyLedgerChanged()
      expect(cb).toHaveBeenCalledTimes(2)
      off()
    })
    it('nested calls send one notification, when the outermost settles', async () => {
      vi.stubGlobal('window', new EventTarget())
      const cb = vi.fn()
      const off = onLedgerChanged(cb)
      await withoutNotifications(async () => {
        await withoutNotifications(async () => notifyLedgerChanged())
        expect(cb).not.toHaveBeenCalled()
      })
      expect(cb).toHaveBeenCalledTimes(1)
      off()
    })
    it('still notifies once and lets the error through when fn throws', async () => {
      vi.stubGlobal('window', new EventTarget())
      const cb = vi.fn()
      const off = onLedgerChanged(cb)
      await expect(withoutNotifications(async () => { throw new Error('boom') })).rejects.toThrow('boom')
      expect(cb).toHaveBeenCalledTimes(1)
      notifyLedgerChanged()
      expect(cb).toHaveBeenCalledTimes(2)
      off()
    })
  })
})
