import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({ notifyLedgerChanged: () => notify() }))

import { importStatement, listImports, undoImport } from '@/lib/api/import-client'
import type { ImportOp } from '@/lib/domain/import/types'
import type { StepStatement } from '@/lib/domain/import/request'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function ops(n: number): ImportOp[] {
  return Array.from({ length: n }, (_, i) => ({
    day: '2026-11-01',
    type: 'expense' as const,
    amountMinor: 100 + i,
    ordinal: i,
    reference: null,
    counterpartyName: null,
    remittance: `line ${i}`,
  }))
}

const statement: StepStatement = { source: 'PL123', currency: 'PLN', from: '2026-11-01', to: '2026-11-30', closingMinor: 5000 }

function stepAnswer(importId: string, extra: Record<string, unknown> = {}) {
  return {
    importId,
    created: 25,
    skipped: { seen: 0, bank: 0 },
    refused: [],
    done: false,
    balanceMinor: null,
    closingMinor: null,
    differenceMinor: null,
    fitted: false,
    ...extra,
  }
}

function sentBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
}

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('importStatement', () => {
  it('sends 60 operations in steps of 25, carries the importId and sets last only on the final step', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(stepAnswer('imp1')))
      .mockResolvedValueOnce(json(stepAnswer('imp1')))
      .mockResolvedValueOnce(json(stepAnswer('imp1', { done: true, fitted: true, balanceMinor: 5000, closingMinor: 5000, differenceMinor: 0 })))
    vi.stubGlobal('fetch', fetchMock)
    const progress: Array<[number, number]> = []

    const result = await importStatement('org1', {
      fileName: 'a.sta',
      accountId: 'acc1',
      statement,
      operations: ops(60),
      onProgress: (done, total) => progress.push([done, total]),
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const call of fetchMock.mock.calls) expect(call[0]).toBe('/api/orgs/org1/imports')
    const bodies = fetchMock.mock.calls.map(sentBody)
    expect(bodies.map((b) => (b.operations as unknown[]).length)).toEqual([25, 25, 10])
    expect(bodies.map((b) => b.last)).toEqual([false, false, true])
    expect(bodies[0]).not.toHaveProperty('importId')
    expect(bodies[1].importId).toBe('imp1')
    expect(bodies[2].importId).toBe('imp1')
    expect(bodies[0]).toMatchObject({ fileName: 'a.sta', accountId: 'acc1', statement })
    expect(progress).toEqual([
      [25, 60],
      [50, 60],
      [60, 60],
    ])
    expect(result).toMatchObject({ importId: 'imp1', created: 75, busy: false, fitted: true, balanceMinor: 5000, closingMinor: 5000, differenceMinor: 0 })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('sends one step with an empty operation list and last true so the fitting still runs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(stepAnswer('imp2', { created: 0, done: true, fitted: true, balanceMinor: 1, closingMinor: 1, differenceMinor: 0 })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await importStatement('org1', { fileName: 'a.sta', accountId: 'acc1', statement, operations: [] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = sentBody(fetchMock.mock.calls[0])
    expect(body.operations).toEqual([])
    expect(body.last).toBe(true)
    expect(result.importId).toBe('imp2')
    expect(result.fitted).toBe(true)
  })

  it('stops with busy true on 409 already_running and keeps the importId of the earlier steps', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(stepAnswer('imp3')))
      .mockResolvedValueOnce(json({ error: 'already_running' }, 409))
    vi.stubGlobal('fetch', fetchMock)

    const result = await importStatement('org1', { fileName: 'a.sta', accountId: 'acc1', statement, operations: ops(60) })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.busy).toBe(true)
    expect(result.importId).toBe('imp3')
    expect(result.created).toBe(25)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('throws the API error on another failure and still tells the journal once', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: 'account_not_found' }, 404))
    vi.stubGlobal('fetch', fetchMock)

    await expect(importStatement('org1', { fileName: 'a.sta', accountId: 'acc1', statement, operations: ops(3) })).rejects.toMatchObject({
      status: 404,
      code: 'account_not_found',
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('undoImport', () => {
  it('loops with the cursor, accumulates deleted and kept, stops on done and tells the journal once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ deleted: 25, kept: [{ id: 'k1', reason: 'changed' }], next: 'c1', done: false }))
      .mockResolvedValueOnce(json({ deleted: 3, kept: [], next: null, done: true }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []

    const result = await undoImport('org1', 'imp1', { onProgress: (deleted) => progress.push(deleted) })

    expect(result).toEqual({ deleted: 28, kept: [{ id: 'k1', reason: 'changed' }] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/imports/imp1/undo')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(sentBody(fetchMock.mock.calls[0])).toEqual({})
    expect(sentBody(fetchMock.mock.calls[1])).toEqual({ cursor: 'c1' })
    expect(progress).toEqual([25, 28])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('stops after the runaway limit and reports it as an error instead of a partial success', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ deleted: 0, kept: [], next: 'c', done: false }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(undoImport('org1', 'imp1')).rejects.toMatchObject({ code: 'undo_incomplete' })
    expect(fetchMock).toHaveBeenCalledTimes(400)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('listImports', () => {
  it('returns the imports of the list response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ imports: [{ id: 'imp1' }] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await listImports('org1')).toEqual([{ id: 'imp1' }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/imports')
  })
})
