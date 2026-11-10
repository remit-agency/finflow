import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({ notifyLedgerChanged: () => notify(), onLedgerChanged: () => () => {} }))

import { confirmMatches, deleteSeries, onRecurringChanged, skipPlan, undoMatches } from '@/lib/api/recurring-client'
import type { PlanMatch } from '@/lib/domain/recurring/types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const PLAN = 'pl_ser1_2026-11-10'
const BANK = `bk_${'a'.repeat(32)}`
const pair: PlanMatch = {
  plan: { id: PLAN, version: '1.000000001', type: 'expense', accountId: 'mil', amountMinor: 1, currency: 'PLN', paymentDate: '2026-11-10', seriesId: 'ser1', occurrence: '2026-11-10', estimated: false },
  bank: { id: BANK, version: '1.000000002', type: 'expense', accountId: 'mil', amountMinor: 1, currency: 'PLN', paymentDate: '2026-11-11' },
}

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('recurring calls', () => {
  it('confirms pairs with the versions the person saw and tells the journal and the page', async () => {
    // The unit tests run in Node: a bare EventTarget stands in for the window the events go through.
    vi.stubGlobal('window', new EventTarget())
    const heard = vi.fn()
    const off = onRecurringChanged(heard)
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ results: [{ planId: PLAN, ok: true, bankId: BANK }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await confirmMatches('org 1', [pair])).toEqual([{ planId: PLAN, ok: true, bankId: BANK }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org%201/recurring/matches')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirm: [{ planId: PLAN, bankId: BANK, versions: ['1.000000001', '1.000000002'] }] })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledTimes(1)
    off()
  })

  it('undoes in requests of at most 50', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `pl_s${i}_2026-11-10`)
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) =>
      json({ results: (JSON.parse(init.body) as { undo: string[] }).undo.map((planId) => ({ planId, ok: true, bankId: BANK })) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await undoMatches('org1', ids)).toHaveLength(51)
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).undo.length)).toEqual([50, 1])
  })

  it('deletes a series with the choice for the future plans, and a skip answers the plan as it was', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ deleted: 2 })).mockResolvedValueOnce(json({ before: { id: PLAN } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await deleteSeries('org1', 'ser1', 'keep')).toEqual({ deleted: 2 })
    expect(await skipPlan('org1', 'ser1', '2026-11-10')).toEqual({ id: PLAN })
    expect(fetchMock.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
      ['/api/orgs/org1/recurring/ser1?future=keep', 'DELETE'],
      ['/api/orgs/org1/recurring/ser1/skip', 'POST'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ occurrence: '2026-11-10' })
  })
})
