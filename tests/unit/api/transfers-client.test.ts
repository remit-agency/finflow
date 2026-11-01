import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({
  notifyLedgerChanged: () => notify(),
  withoutNotifications: async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn()
    } finally {
      notify()
    }
  },
}))

import { confirmPairs, convertToTransfers, mergeIntoTransfer, splitTransfer, undoTransfers } from '@/lib/api/transfers-client'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import type { MadeOutcome, TransferSuggestion } from '@/lib/domain/transfers/types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const side = (id: string, version: string) => ({ id, version, accountId: 'a', amountMinor: 1, currency: 'PLN', paymentDate: '2026-10-20' })
const pair: TransferSuggestion = { from: side('bk_a1', '1.000000001'), to: side('bk_b1', '1.000000002') }

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('transfer calls', () => {
  it('confirms pairs with the versions the person saw, merges, splits, and reloads the journal after each', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ results: [{ ids: ['bk_a1', 'bk_b1'], ok: false, code: 'conflict' }] }))
      .mockResolvedValueOnce(json({ results: [{ ids: ['x', 'y'], ok: false, code: 'not_eligible' }] }))
      .mockResolvedValueOnce(json({ restored: [{ id: 'bk_a1' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await confirmPairs('org 1', [pair])).toEqual([{ ids: ['bk_a1', 'bk_b1'], ok: false, code: 'conflict' }])
    expect(await mergeIntoTransfer('org 1', ['x', 'y'])).toEqual({ ids: ['x', 'y'], ok: false, code: 'not_eligible' })
    expect(await splitTransfer('org 1', 'bk_a1')).toEqual([{ id: 'bk_a1' }])
    expect(fetchMock.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
      ['/api/orgs/org%201/transfers', 'POST'],
      ['/api/orgs/org%201/transfers', 'POST'],
      ['/api/orgs/org%201/transfers/bk_a1/split', 'POST'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ pairs: [{ fromId: 'bk_a1', toId: 'bk_b1', versions: ['1.000000001', '1.000000002'] }] })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ merge: ['x', 'y'] })
    expect(fetchMock.mock.calls[2][1].body).toBeUndefined()
    expect(notify).toHaveBeenCalledTimes(3)
  })

  it('converts in requests of 25; a failed request makes its ids and the rest unknown and stops', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `c${i}`)
    const ok = (chunk: string[]) => json({ results: chunk.map((id) => ({ ids: [id], ok: true, id, deletedId: null, droppedTags: 0, before: [] })) })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(ids.slice(0, 25)))
      .mockResolvedValueOnce(json({ error: 'internal' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const out = await convertToTransfers('org1', ids, 'cash')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ convert: { ids: ids.slice(0, 25), toAccountId: 'cash' } })
    expect(out).toHaveLength(60)
    expect(out.slice(0, 25).every((o) => o.ok)).toBe(true)
    expect(out.slice(25).every((o) => !o.ok && o.code === 'unknown')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('undoTransfers', () => {
  it('splits each transfer and writes its operations back as they were; a failure counts and the rest go on', async () => {
    const before = (id: string) => ({ id }) as LedgerTransaction
    const made = (id: string, prior: string[]): MadeOutcome => ({ ids: prior, ok: true, id, deletedId: null, droppedTags: 0, before: prior.map(before) })
    const calls: string[] = []
    const out = await undoTransfers('org1', [made('t1', ['t1', 'b1']), made('t2', ['t2']), made('t3', ['t3'])], {
      split: async (id) => {
        calls.push(`split:${id}`)
        if (id === 't2') throw new Error('conflict')
      },
      revert: async (tx) => {
        calls.push(`revert:${tx.id}`)
      },
    })
    expect(out).toEqual({ done: 2, failed: 1 })
    expect(calls).toEqual(['split:t1', 'revert:t1', 'revert:b1', 'split:t2', 'split:t3', 'revert:t3'])
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
