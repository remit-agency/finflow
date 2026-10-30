import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({ notifyLedgerChanged: () => notify() }))

import { LedgerApiError } from '@/lib/api/ledger-client'
import { createTag, duplicateTagOf, RecalcRunError, recalculateTag, tagImpact, updateTag } from '@/lib/api/tags-client'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const TAG = { id: 'tg1', name: 'ПДВ', color: 'slate', excludeFromAnalytics: true, archived: false, recalcPending: false }

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('tag calls', () => {
  it('create, edit and impact go to their paths', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ tag: TAG }, 201))
      .mockResolvedValueOnce(json({ tag: { ...TAG, recalcPending: true }, recalc: true }))
      .mockResolvedValueOnce(json({ operations: 12 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await createTag('org 1', { name: 'ПДВ', excludeFromAnalytics: true })).toEqual(TAG)
    expect(await updateTag('org 1', 'tg1', { excludeFromAnalytics: true })).toEqual({ tag: { ...TAG, recalcPending: true }, recalc: true })
    expect(await tagImpact('org 1', 'tg1')).toBe(12)
    expect(fetchMock.mock.calls.map((c) => [c[0], c[1]?.method ?? 'GET'])).toEqual([
      ['/api/orgs/org%201/tags', 'POST'],
      ['/api/orgs/org%201/tags/tg1', 'PATCH'],
      ['/api/orgs/org%201/tags/tg1/impact', 'GET'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'ПДВ', excludeFromAnalytics: true })
  })

  it('a taken name is a duplicate with the id of the tag that has it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'duplicate', field: 'name', existingId: 'tg0' }, 409)))
    const error = await createTag('org1', { name: 'vat' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LedgerApiError)
    expect(duplicateTagOf(error)).toEqual({ existingId: 'tg0' })
    expect(duplicateTagOf(new LedgerApiError(409, 'limit_reached'))).toBeNull()
  })
})

describe('recalculateTag', () => {
  it('asks step by step with the cursor until done, adds the counts and reloads the journal once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ scanned: 100, changed: 100, done: false, cursor: 'tx-100' }))
      .mockResolvedValueOnce(json({ scanned: 20, changed: 19, done: true, cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []
    const totals = await recalculateTag('org1', 'tg1', { onProgress: (t) => progress.push(t.scanned) })
    expect(totals).toEqual({ scanned: 120, changed: 119, stoppedEarly: false })
    expect(progress).toEqual([100])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/tags/tg1/recalculate')
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))).toEqual([{}, { cursor: 'tx-100' }])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('a failed step keeps the counts read so far', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ scanned: 100, changed: 3, done: false, cursor: 'tx-100' }))
      .mockResolvedValueOnce(json({ error: 'ledger_busy' }, 409)))
    const error = await recalculateTag('org1', 'tg1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RecalcRunError)
    expect((error as RecalcRunError).totals).toEqual({ scanned: 100, changed: 3, stoppedEarly: true })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('nothing changed: the journal is left alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ scanned: 4, changed: 0, done: true, cursor: null })))
    expect(await recalculateTag('org1', 'tg1')).toEqual({ scanned: 4, changed: 0, stoppedEarly: false })
    expect(notify).not.toHaveBeenCalled()
  })
})
