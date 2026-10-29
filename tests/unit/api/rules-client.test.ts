import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({ notifyLedgerChanged: () => notify() }))

import { applyToExisting, checkExisting, createRule, deleteRule, fetchRules, orderRules, previewRule, RulesRunError } from '@/lib/api/rules-client'
import type { RuleInput } from '@/lib/domain/rules/input'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const RULE: RuleInput = {
  name: 'Paliwo', type: 'expense', active: true,
  conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }], actions: { categoryId: 'k-fuel' },
}

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('rules calls', () => {
  it('reads the list and sends create, delete and order to their paths', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ rules: [{ id: 'r1' }] }))
      .mockResolvedValueOnce(json({ rule: { id: 'r2' } }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchRules('org 1')).toEqual([{ id: 'r1' }])
    expect(await createRule('org 1', RULE)).toEqual({ id: 'r2' })
    await deleteRule('org 1', 'r2')
    await orderRules('org 1', ['r1'])
    expect(fetchMock.mock.calls.map((c) => [c[0], c[1]?.method ?? 'GET'])).toEqual([
      ['/api/orgs/org%201/rules', 'GET'],
      ['/api/orgs/org%201/rules', 'POST'],
      ['/api/orgs/org%201/rules/r2', 'DELETE'],
      ['/api/orgs/org%201/rules/order', 'POST'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(RULE)
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ ids: ['r1'] })
  })

  it('a refusal throws with its status, code and field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'category_not_found', field: 'actions.categoryId' }, 422)))
    await expect(createRule('org1', RULE)).rejects.toMatchObject({ status: 422, code: 'category_not_found', details: { field: 'actions.categoryId' } })
  })

  it('previews a draft rule', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ matched: 3, scanned: 40, capped: false }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await previewRule('org1', RULE)).toEqual({ matched: 3, scanned: 40, capped: false })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/rules/preview')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ rule: RULE })
  })

  it('passes the signal to the preview so a stale check can be stopped', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ matched: 0, scanned: 0, capped: false }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await previewRule('org1', RULE, controller.signal)
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

describe('checkExisting', () => {
  it('asks step by step with the cursor until done, adds the counts and leaves the journal alone', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ scanned: 200, matchOps: 4, categories: 4, counterparties: 1, done: false, cursor: 'c1' }))
      .mockResolvedValueOnce(json({ scanned: 37, matchOps: 1, categories: 0, counterparties: 1, done: true, cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []
    const totals = await checkExisting('org1', { onProgress: (t) => progress.push(t.scanned) })
    expect(totals).toEqual({ scanned: 237, matchOps: 5, categories: 4, counterparties: 2, stoppedEarly: false })
    expect(progress).toEqual([200])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/rules/apply')
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))).toEqual([{ mode: 'check' }, { mode: 'check', cursor: 'c1' }])
    expect(notify).not.toHaveBeenCalled()
  })

  it('reports stoppedEarly when the step cap ends the count before done', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ scanned: 1, matchOps: 0, categories: 0, counterparties: 0, done: false, cursor: 'c' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await checkExisting('org1')).toEqual({ scanned: 2000, matchOps: 0, categories: 0, counterparties: 0, stoppedEarly: true })
    expect(fetchMock).toHaveBeenCalledTimes(2000)
  })
})

describe('applyToExisting', () => {
  it('applies step by step, adds the counts and tells the journal once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ scanned: 60, changed: 25, failed: 0, done: false, cursor: 'c1' }))
      .mockResolvedValueOnce(json({ scanned: 140, changed: 3, failed: 1, done: true, cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []
    expect(await applyToExisting('org1', { onProgress: (t) => progress.push(t.changed) })).toEqual({ scanned: 200, changed: 28, failed: 1, stoppedEarly: false })
    expect(progress).toEqual([25])
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))).toEqual([{ mode: 'apply' }, { mode: 'apply', cursor: 'c1' }])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not touch the journal when nothing changed, and throws a refusal with its code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ scanned: 5, changed: 0, failed: 0, done: true, cursor: null })))
    await applyToExisting('org1')
    expect(notify).not.toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'forbidden' }, 403)))
    await expect(applyToExisting('org1')).rejects.toMatchObject({ cause: { status: 403, code: 'forbidden' }, totals: { changed: 0 } })
  })

  it('reports stoppedEarly when the step cap ends the run before done, keeping the counts', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ scanned: 1, changed: 1, failed: 0, done: false, cursor: 'c' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await applyToExisting('org1')).toEqual({ scanned: 2000, changed: 2000, failed: 0, stoppedEarly: true })
    expect(fetchMock).toHaveBeenCalledTimes(2000)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('keeps the counts of the steps before a failure, with the error as the cause', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ scanned: 60, changed: 5, failed: 0, done: false, cursor: 'c1' }))
      .mockResolvedValueOnce(json({ error: 'internal' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const err = await applyToExisting('org1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RulesRunError)
    expect(err).toMatchObject({ totals: { scanned: 60, changed: 5, failed: 0 }, cause: { status: 500, code: 'internal' } })
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
