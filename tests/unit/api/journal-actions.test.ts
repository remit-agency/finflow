import { describe, expect, it, vi } from 'vitest'
import { notifyLedgerChanged, onLedgerChanged } from '@/lib/api/ledger-events'
import { bulkChange, bulkDelete, undoBulkChange, undoBulkDelete } from '@/lib/api/journal-actions'
import type { BulkOutcome } from '@/lib/domain/journal/bulk-input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (id: string, over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id,
  type: 'expense',
  status: 'actual',
  accountId: 'a1',
  amountMinor: 1000,
  currency: 'PLN',
  paymentDate: '2026-10-10',
  accrual: { mode: 'date', date: '2026-10-10' },
  isRecurring: false,
  tags: [],
  fileUrls: [],
  ...over,
})

const ok = (id: string): BulkOutcome => ({ id, ok: true })

describe('bulkChange', () => {
  it('sends only what the patch applies to and reports skipped, applied and failed', async () => {
    const send = vi.fn(async (_action: 'update' | 'delete', ids: string[]) =>
      ids.map((id): BulkOutcome => (id === 'bad' ? { id, ok: false, code: 'counterparty_archived' } : ok(id))),
    )
    const rows = [tx('a'), tx('b', { type: 'transfer', toAccountId: 'a2', toAmountMinor: 1000, toCurrency: 'PLN' }), tx('bad')]
    const result = await bulkChange(rows, { counterpartyId: 'cp1' }, { today: '2026-10-27', send })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1]).toEqual(['a', 'bad'])
    expect(result.skipped).toEqual([{ id: 'b', reason: 'transfer' }])
    expect(result.applied.map((r) => r.id)).toEqual(['a'])
    expect(result.failed).toEqual([{ id: 'bad', code: 'counterparty_archived' }])
  })
})

describe('bulkDelete', () => {
  it('reports what was deleted, with the rows to restore', async () => {
    const send = vi.fn(async (_a: 'update' | 'delete', ids: string[]) => ids.map(ok))
    const result = await bulkDelete([tx('a'), tx('b')], { send })
    expect(result.applied.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('undo', () => {
  it('undoBulkChange writes every earlier row back and counts failures', async () => {
    const revert = vi.fn(async (row: LedgerTransaction) => {
      if (row.id === 'b') throw new Error('nope')
    })
    const out = await undoBulkChange([tx('a'), tx('b')], { revert })
    expect(out).toEqual({ done: 1, failed: 1 })
  })
  it('undoBulkDelete creates every row again and counts failures', async () => {
    const restore = vi.fn(async () => undefined)
    expect(await undoBulkDelete([tx('a'), tx('b')], { restore })).toEqual({ done: 2, failed: 0 })
  })
  it('an undo of many rows tells the journal once, after the last row', async () => {
    vi.stubGlobal('window', new EventTarget())
    const seen = vi.fn()
    const off = onLedgerChanged(seen)
    const revert = vi.fn(async () => {
      notifyLedgerChanged()
      expect(seen).not.toHaveBeenCalled()
    })
    await undoBulkChange([tx('a'), tx('b'), tx('c')], { revert })
    expect(revert).toHaveBeenCalledTimes(3)
    expect(seen).toHaveBeenCalledTimes(1)
    const restore = vi.fn(async () => notifyLedgerChanged())
    await undoBulkDelete([tx('a'), tx('b')], { restore })
    expect(seen).toHaveBeenCalledTimes(2)
    off()
    vi.unstubAllGlobals()
  })
})
