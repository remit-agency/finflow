import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({ notifyLedgerChanged: () => notify() }))

import { normKey } from '@/lib/domain/import/finmap/fold'
import { countAlreadyImported, runFinmapImport, type FinmapResult, type FinmapRunArgs } from '@/lib/api/finmap-client'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import type { FinmapCounts, FinmapExisting, FinmapPlan, FinmapRow, PlannedOp } from '@/lib/domain/import/finmap/types'

// Synthetic names only.
const EXISTING: FinmapExisting = {
  companyCurrency: 'PLN',
  accounts: [{ id: 'acc-a', name: 'Konto Alfa', currency: 'PLN' }],
  categories: [],
  counterparties: [],
  tags: [],
}

const COUNTS: FinmapCounts = {
  rows: 0, income: 0, expense: 0, transfer: 0, planned: 0, pairCandidatesLeft: 0, refused: {},
  warnings: { commentCut: 0, subcounterparty: 0, project: 0, accrualIgnored: 0, categoryIgnored: 0, archivedMatched: 0 },
}

const ZERO_ENTITIES = { accounts: 0, categories: 0, counterparties: 0, tags: 0 }

function planOp(i: number, over: Partial<PlannedOp> = {}): PlannedOp {
  return {
    kind: 'expense',
    status: 'actual',
    day: '2026-11-03',
    amountMinor: 100 + i,
    account: 'Konto Alfa',
    toAccount: null,
    toAmountMinor: null,
    category: null,
    counterparty: null,
    tags: [],
    description: null,
    accrual: null,
    identity: [`t${i}`, String(100 + i)],
    ordinal: 0,
    lines: [i + 2],
    ...over,
  }
}

function planOf(operations: PlannedOp[]): FinmapPlan {
  return {
    operations,
    period: null,
    create: { accounts: [], categories: [], counterparties: [], tags: [] },
    matched: { accounts: 0, categories: 0, counterparties: 0, tags: 0 },
    counts: COUNTS,
  }
}

type Step = 'setup' | 'check' | 'batch' | 'finish'
type Body = Record<string, unknown>
type Handler = (body: Body, call: number, signal: AbortSignal | null | undefined) => Response | Promise<Response>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const apiError = (status: number, error: string) => json({ error }, status)

const SETUP_OK = { importId: 'imp1', accounts: {}, categories: [], counterparties: {}, tags: {}, created: ZERO_ENTITIES }

/** A fake server for the four steps: each defaults to a success; a step's handler replaces its default. */
function serverWith(overrides: Partial<Record<Step, Handler>> = {}) {
  const calls: Array<{ step: Step; body: Body }> = []
  const counts: Record<Step, number> = { setup: 0, check: 0, batch: 0, finish: 0 }
  const defaults: Record<Step, Handler> = {
    setup: () => json(SETUP_OK),
    check: (body) => json({ seen: (body.operations as unknown[]).map(() => false) }),
    batch: (body) => json({ created: (body.operations as unknown[]).length, skipped: 0, refused: [] }),
    finish: () => json({ fitted: [], differences: [] }),
  }
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const step = url.split('/').pop() as Step
    const body = JSON.parse(init.body as string) as Body
    calls.push({ step, body })
    counts[step]++
    const handler = overrides[step] ?? defaults[step]
    return handler(body, counts[step], init.signal)
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    calls,
    steps: (step: Step) => calls.filter((c) => c.step === step),
  }
}

const batchSizes = (calls: Array<{ step: Step; body: Body }>) =>
  calls.filter((c) => c.step === 'batch').map((c) => (c.body.operations as unknown[]).length)

function run(ops: PlannedOp[], extra: Partial<FinmapRunArgs> = {}): Promise<FinmapResult> {
  return runFinmapImport('org1', {
    fileName: 'platnosci.xlsx',
    plan: planOf(ops),
    alternative: [],
    accounts: [],
    existing: EXISTING,
    onProgress: () => {},
    ...extra,
  })
}

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('runFinmapImport: batches', () => {
  it('sends 130 operations as batches of 60, 60 and 10, then finishes once', async () => {
    const s = serverWith()
    const ops = Array.from({ length: 130 }, (_, i) => planOp(i))
    const result = await run(ops)
    expect(batchSizes(s.calls)).toEqual([60, 60, 10])
    expect(s.steps('finish')).toHaveLength(1)
    expect(result).toMatchObject({ importId: 'imp1', created: 130, skipped: 0, refused: { total: 0, byReason: {}, sample: [] }, fitted: 0, differences: [], tagsDropped: 0 })
    expect(result.error).toBeUndefined()
    expect(result.busy).toBeUndefined()
  })

  it('sends the operations in plan order, with ids resolved from the existing account', async () => {
    const s = serverWith()
    await run([planOp(0), planOp(1)])
    const sent = s.steps('batch')[0].body.operations as Array<{ accountId: string; identity: string[] }>
    expect(sent.map((o) => o.identity[0])).toEqual(['t0', 't1'])
    expect(sent.every((o) => o.accountId === 'acc-a')).toBe(true)
  })

  it('checks only the operations whose accounts existed before, in chunks of 500', async () => {
    const newAccount = { name: 'Konto Nowe', type: 'bank' as const, currency: 'PLN', currentBalanceMinor: null }
    const ops = [...Array.from({ length: 501 }, (_, i) => planOp(i)), planOp(9999, { account: 'Konto Nowe' })]
    const s = serverWith({ setup: () => json({ ...SETUP_OK, accounts: { 'konto nowe': 'acc-n' } }) })
    await run(ops, { accounts: [newAccount] })
    expect(s.steps('check').map((c) => (c.body.operations as unknown[]).length)).toEqual([500, 1])
  })

  it('skips the duplicate check for an operation on a new account', async () => {
    const newAccount = { name: 'Konto Nowe', type: 'bank' as const, currency: 'PLN', currentBalanceMinor: null }
    const s = serverWith({ setup: () => json({ ...SETUP_OK, accounts: { 'konto nowe': 'acc-n' } }) })
    await run([planOp(0), planOp(1, { account: 'Konto Nowe' })], { accounts: [newAccount] })
    expect(s.steps('check')).toHaveLength(1)
    expect((s.steps('check')[0].body.operations as unknown[]).length).toBe(1)
    expect(batchSizes(s.calls)).toEqual([2])
  })
})

describe('runFinmapImport: the duplicate check', () => {
  it('leaves out the operations already written and counts them as skipped', async () => {
    const s = serverWith({ check: (body) => json({ seen: (body.operations as unknown[]).map((_, i) => i < 5) }) })
    const progress: Array<[number, number]> = []
    const result = await run(Array.from({ length: 12 }, (_, i) => planOp(i)), { onProgress: (d, t) => progress.push([d, t]) })
    expect(batchSizes(s.calls)).toEqual([7])
    const sent = s.steps('batch')[0].body.operations as Array<{ identity: string[] }>
    expect(sent[0].identity[0]).toBe('t5')
    expect(result).toMatchObject({ created: 7, skipped: 5 })
    expect(progress).toEqual([[5, 12], [12, 12]])
  })
})

describe('runFinmapImport: progress and refusals', () => {
  it('reports done over total after each batch, counting created, skipped and refused', async () => {
    const progress: Array<[number, number]> = []
    serverWith({
      batch: (body) => {
        const n = (body.operations as unknown[]).length
        return json({ created: n - 1, skipped: 0, refused: [{ index: 0, reason: 'date' }] })
      },
    })
    await run(Array.from({ length: 130 }, (_, i) => planOp(i)), { onProgress: (d, t) => progress.push([d, t]) })
    expect(progress).toEqual([[60, 130], [120, 130], [130, 130]])
  })

  it('maps a refused index to the line of its operation and counts refusals by reason', async () => {
    serverWith({
      batch: () => json({ created: 1, skipped: 0, refused: [{ index: 1, reason: 'account_not_found' }, { index: 2, reason: 'date' }] }),
    })
    const result = await run([planOp(0, { lines: [10] }), planOp(1, { lines: [11] }), planOp(2, { lines: [12, 13] })])
    expect(result.refused).toEqual({
      total: 2,
      byReason: { account_not_found: 1, date: 1 },
      sample: [
        { line: 11, reason: 'account_not_found' },
        { line: 12, reason: 'date' },
      ],
    })
  })

  it('caps the refusal sample', async () => {
    serverWith({
      batch: (body) => json({ created: 0, skipped: 0, refused: (body.operations as unknown[]).map((_, index) => ({ index, reason: 'date' })) }),
    })
    const result = await run(Array.from({ length: 80 }, (_, i) => planOp(i)))
    expect(result.refused.total).toBe(80)
    expect(result.refused.sample.length).toBe(20)
  })

  it('reports the tags the resolver dropped from operations with more than ten tags', async () => {
    serverWith({ setup: () => json({ ...SETUP_OK, tags: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`t${i}`, `id${i}`])) }) })
    const tags = Array.from({ length: 12 }, (_, i) => `T${i}`)
    const result = await run([planOp(0, { tags })])
    expect(result.tagsDropped).toBe(2)
  })
})

describe('runFinmapImport: retries and stops', () => {
  it('retries a batch once on a conflict and carries on', async () => {
    const s = serverWith({
      batch: (body, call) => (call === 1 ? apiError(409, 'conflict') : json({ created: (body.operations as unknown[]).length, skipped: 0, refused: [] })),
    })
    const result = await run(Array.from({ length: 70 }, (_, i) => planOp(i)))
    // The first batch of 60 is sent twice (the conflict, then its retry), then the last 10.
    expect(batchSizes(s.calls)).toEqual([60, 60, 10])
    expect(result.created).toBe(70)
    expect(result.error).toBeUndefined()
    expect(s.steps('finish')).toHaveLength(1)
  })

  it('retries a batch once after a network error', async () => {
    let first = true
    const s = serverWith({
      batch: (body) => {
        if (first) {
          first = false
          throw new TypeError('Failed to fetch')
        }
        return json({ created: (body.operations as unknown[]).length, skipped: 0, refused: [] })
      },
    })
    const result = await run([planOp(0), planOp(1)])
    expect(batchSizes(s.calls)).toEqual([2, 2])
    expect(result.created).toBe(2)
    expect(result.error).toBeUndefined()
  })

  it('stops after a second failure of the same batch: an error, no finish, one notification', async () => {
    const s = serverWith({ batch: () => apiError(409, 'conflict') })
    const result = await run(Array.from({ length: 130 }, (_, i) => planOp(i)))
    expect(batchSizes(s.calls)).toEqual([60, 60])
    expect(result.error).toBe('conflict')
    expect(result.busy).toBeUndefined()
    expect(s.steps('finish')).toHaveLength(0)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('stops a batch that fails again after a network error, with the code "network"', async () => {
    const s = serverWith({
      batch: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const result = await run([planOp(0)])
    expect(batchSizes(s.calls)).toEqual([1, 1])
    expect(result.error).toBe('network')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('stops at once on busy (409 already_running) and reports busy, with no finish', async () => {
    const s = serverWith({ batch: (_body, call) => (call === 1 ? json({ created: 60, skipped: 0, refused: [] }) : apiError(409, 'already_running')) })
    const result = await run(Array.from({ length: 130 }, (_, i) => planOp(i)))
    expect(batchSizes(s.calls)).toEqual([60, 60])
    expect(result.busy).toBe(true)
    expect(result.importId).toBe('imp1')
    expect(result.created).toBe(60)
    expect(result.error).toBeUndefined()
    expect(s.steps('finish')).toHaveLength(0)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('reports busy from the set-up step without writing anything', async () => {
    const s = serverWith({ setup: () => apiError(409, 'already_running') })
    const result = await run([planOp(0)])
    expect(result).toMatchObject({ busy: true, importId: null, created: 0 })
    expect(s.steps('batch')).toHaveLength(0)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('stops with the ledger_busy code, which the screen can show', async () => {
    const s = serverWith({ batch: () => apiError(409, 'ledger_busy') })
    const result = await run([planOp(0)])
    expect(result.error).toBe('ledger_busy')
    expect(result.busy).toBeUndefined()
    expect(s.steps('batch')).toHaveLength(1)
    expect(s.steps('finish')).toHaveLength(0)
  })
})

describe('runFinmapImport: the import id', () => {
  it('reports the import id as soon as the set-up answers, so a later failure can still be retried with it', async () => {
    serverWith({ batch: () => { throw new Error('the connection dropped in another way') } })
    const reported: string[] = []
    await expect(run([planOp(0)], { onImportId: (id) => reported.push(id) })).rejects.toThrow('the connection dropped in another way')
    expect(reported).toEqual(['imp1'])
  })
})

describe('runFinmapImport: abort and notification', () => {
  it('stops between requests when the signal is aborted, sending no further batch or finish', async () => {
    const controller = new AbortController()
    const s = serverWith({
      batch: (body, call) => {
        if (call === 1) controller.abort()
        return json({ created: (body.operations as unknown[]).length, skipped: 0, refused: [] })
      },
    })
    const result = await run(Array.from({ length: 130 }, (_, i) => planOp(i)), { signal: controller.signal })
    expect(batchSizes(s.calls)).toEqual([60])
    expect(result).toMatchObject({ created: 60, error: 'aborted' })
    expect(s.steps('finish')).toHaveLength(0)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('calls notifyLedgerChanged once on success', async () => {
    serverWith()
    await run([planOp(0)])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('sends the set-up body with the planned names and the optional importId', async () => {
    const s = serverWith()
    const newAccount = { name: 'Konto Nowe', type: 'bank' as const, currency: 'PLN', currentBalanceMinor: 500 }
    const plan = { ...planOf([planOp(0)]), create: { accounts: ['Konto Nowe'], categories: [], counterparties: ['Firma'], tags: ['Tag'] } }
    await runFinmapImport('org1', { fileName: 'a.xlsx', plan, alternative: [], accounts: [newAccount], existing: EXISTING, importId: 'imp0', onProgress: () => {} })
    expect(s.steps('setup')[0].body).toEqual({
      importId: 'imp0',
      fileName: 'a.xlsx',
      accounts: [newAccount],
      categories: [],
      counterparties: ['Firma'],
      tags: ['Tag'],
    })
  })
})

describe('runFinmapImport: request size', () => {
  // Long names: 17 identity strings of 400 characters and a 500-character description, as the parser allows.
  const longOp = (i: number, char = 'x') =>
    planOp(i, { identity: Array.from({ length: 17 }, (_, k) => `${i}.${k}.` + char.repeat(400)), description: char.repeat(500) })
  const bodyBytes = (body: Body) => new TextEncoder().encode(JSON.stringify(body)).length
  const counts = (calls: Array<{ body: Body }>) => calls.map((c) => (c.body.operations as unknown[]).length)

  it('splits checks by size: each request stays within 180 KB of JSON, every operation is checked once', async () => {
    const s = serverWith()
    await run(Array.from({ length: 300 }, (_, i) => longOp(i)))
    const checks = s.steps('check')
    expect(checks.length).toBeGreaterThan(1)
    expect(checks.every((c) => bodyBytes(c.body) <= 180 * 1024 + 64)).toBe(true)
    expect(counts(checks).every((n) => n <= 500)).toBe(true)
    expect(counts(checks).reduce((a, b) => a + b, 0)).toBe(300)
  })

  it('splits batches by size: each request stays within 200 KB of JSON and every operation is sent', async () => {
    const s = serverWith()
    const result = await run(Array.from({ length: 80 }, (_, i) => longOp(i)))
    const batches = s.steps('batch')
    expect(batches.length).toBeGreaterThan(2)
    expect(batches.every((c) => bodyBytes(c.body) <= 200 * 1024 + 64)).toBe(true)
    expect(counts(batches).every((n) => n <= 60)).toBe(true)
    expect(counts(batches).reduce((a, b) => a + b, 0)).toBe(80)
    expect(result.created).toBe(80)
  })

  it('measures Cyrillic by its UTF-8 bytes (two per letter), the length the route checks', async () => {
    const s = serverWith()
    await run(Array.from({ length: 120 }, (_, i) => longOp(i, 'ж')))
    expect(s.steps('check').every((c) => bodyBytes(c.body) <= 180 * 1024 + 64)).toBe(true)
    expect(s.steps('batch').every((c) => bodyBytes(c.body) <= 200 * 1024 + 64)).toBe(true)
  })

  it('sends a check operation over the budget alone', async () => {
    const s = serverWith()
    await run([planOp(0), planOp(1, { identity: ['h'.repeat(300 * 1024)] }), planOp(2)])
    expect(counts(s.steps('check'))).toEqual([1, 1, 1])
  })

  it('sends a batch operation over the budget alone', async () => {
    const s = serverWith()
    await run([planOp(0), planOp(1, { identity: ['h'.repeat(300 * 1024)] }), planOp(2)])
    expect(counts(s.steps('batch'))).toEqual([1, 1, 1])
  })
})

describe('runFinmapImport: the accounts it created', () => {
  it('names the new accounts with the ids the set-up step gave them', async () => {
    serverWith({ setup: () => json({ ...SETUP_OK, accounts: { [normKey('Konto Nowe')]: 'acc-new' } }) })
    const result = await run([planOp(1, { account: 'Konto Nowe' })], {
      accounts: [{ name: 'Konto Nowe', type: 'bank', currency: 'EUR', currentBalanceMinor: null }],
    })
    expect(result.createdAccounts).toEqual([{ id: 'acc-new', name: 'Konto Nowe', currency: 'EUR' }])
  })
})

describe('countAlreadyImported: the preview count', () => {
  it('checks only the operations whose accounts FinFlow has, and counts the ones the server saw', async () => {
    const server = serverWith({ check: (body) => json({ seen: (body.operations as unknown[]).map((_, i) => i === 0) }) })
    const plan = planOf([planOp(1), planOp(2, { account: 'Konto Nowe' }), planOp(3)])
    const n = await countAlreadyImported('org1', plan, EXISTING, { alternative: [] })
    expect(n).toBe(1)
    const sent = server.steps('check')
    expect(sent).toHaveLength(1)
    expect(sent[0].body.operations).toEqual([
      { accountId: 'acc-a', toAccountId: null, identity: ['t1', '101'], ordinal: 0 },
      { accountId: 'acc-a', toAccountId: null, identity: ['t3', '103'], ordinal: 0 },
    ])
  })

  it('sends no request when no operation is on an account FinFlow has', async () => {
    const server = serverWith()
    expect(await countAlreadyImported('org1', planOf([planOp(1, { account: 'Konto Nowe' })]), EXISTING, { alternative: [] })).toBe(0)
    expect(server.steps('check')).toHaveLength(0)
  })

  it('checks in chunks of at most 500 keys and reports progress over the checkable operations', async () => {
    serverWith()
    const ops = Array.from({ length: 1200 }, (_, i) => planOp(i))
    const progress: Array<[number, number]> = []
    await countAlreadyImported('org1', planOf(ops), EXISTING, { alternative: [], onProgress: (d, t) => progress.push([d, t]) })
    expect(progress).toEqual([
      [500, 1200],
      [1000, 1200],
      [1200, 1200],
    ])
  })

  it('stops when its signal is aborted, sending no further check', async () => {
    const controller = new AbortController()
    const server = serverWith({
      check: (body) => {
        controller.abort()
        return json({ seen: (body.operations as unknown[]).map(() => false) })
      },
    })
    const ops = Array.from({ length: 600 }, (_, i) => planOp(i))
    await expect(countAlreadyImported('org1', planOf(ops), EXISTING, { alternative: [], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(server.steps('check')).toHaveLength(1)
  })
})

// The same two rows (an expense on account A, an income on account B, the same day, minute and amount) planned both ways.
const PAIR_EXISTING: FinmapExisting = {
  companyCurrency: 'PLN',
  accounts: [{ id: 'acc-a', name: 'Konto Alfa', currency: 'PLN' }, { id: 'acc-b', name: 'Konto Beta', currency: 'PLN' }],
  categories: [], counterparties: [], tags: [],
}
const pairRow = (over: Partial<FinmapRow>): FinmapRow => ({
  line: 2, paymentDay: '2026-10-05', timeText: '46000.5', minute: 720, amountMinor: 500,
  from: null, to: null, category: null, subcategory: null, counterparty: null,
  hasSubcounterparty: false, hasProject: false, tags: [], comment: null, period: null,
  ...over,
})
const PAIR_ROWS = [pairRow({ line: 2, from: 'Konto Alfa' }), pairRow({ line: 3, to: 'Konto Beta' })]
const pairPlan = (pairTransfers: boolean): FinmapPlan => planFinmap(PAIR_ROWS, PAIR_EXISTING, { includePlanned: false, pairTransfers, today: '2026-10-20' })

/**
 * A stateful fake of the server's duplicate check and batch: an operation is written once, under its own identity and ordinal
 * (the key the server derives from them). Returns the written set.
 */
function ledgerServer(): Set<string> {
  const written = new Set<string>()
  const keyOf = (o: Body): string => JSON.stringify([o.accountId, o.toAccountId, o.identity, o.ordinal])
  serverWith({
    check: (body) => json({ seen: (body.operations as Body[]).map((o) => written.has(keyOf(o))) }),
    batch: (body) => {
      let created = 0
      for (const o of body.operations as Body[]) {
        if (!written.has(keyOf(o))) {
          written.add(keyOf(o))
          created++
        }
      }
      return json({ created, skipped: 0, refused: [] })
    },
  })
  return written
}

const pairRun = (plan: FinmapPlan, alternative: PlannedOp[]): Promise<FinmapResult> =>
  runFinmapImport('org1', { fileName: 'platnosci.xlsx', plan, alternative, accounts: [], existing: PAIR_EXISTING, onProgress: () => {} })

describe('runFinmapImport: the other pairing of the same rows', () => {
  it('after an import with pairing on, the same file with pairing off creates nothing: its two singles are the transfer already written', async () => {
    const written = ledgerServer()
    expect(await pairRun(pairPlan(true), pairPlan(false).operations)).toMatchObject({ created: 1, skipped: 0 })
    expect(await pairRun(pairPlan(false), pairPlan(true).operations)).toMatchObject({ created: 0, skipped: 2 })
    expect(written.size).toBe(1)
  })

  it('and the reverse: after an import with pairing off, the same file with pairing on creates nothing', async () => {
    const written = ledgerServer()
    expect(await pairRun(pairPlan(false), pairPlan(true).operations)).toMatchObject({ created: 2, skipped: 0 })
    expect(await pairRun(pairPlan(true), pairPlan(false).operations)).toMatchObject({ created: 0, skipped: 1 })
    expect(written.size).toBe(2)
  })

  it('the preview counts the same operations as the run would skip', async () => {
    ledgerServer()
    await pairRun(pairPlan(true), pairPlan(false).operations)
    expect(await countAlreadyImported('org1', pairPlan(false), PAIR_EXISTING, { alternative: pairPlan(true).operations })).toBe(2)
    expect(await countAlreadyImported('org1', pairPlan(true), PAIR_EXISTING, { alternative: pairPlan(false).operations })).toBe(1)
  })

  it('does not check an alternative on an account the run creates; the one on an existing account is checked', async () => {
    const server = serverWith({ setup: () => json({ ...SETUP_OK, accounts: { [normKey('Konto Beta')]: 'acc-new' } }) })
    await runFinmapImport('org1', {
      fileName: 'p.xlsx',
      plan: pairPlan(true),
      alternative: pairPlan(false).operations,
      accounts: [{ name: 'Konto Beta', type: 'bank', currency: 'PLN', currentBalanceMinor: null }],
      existing: { ...PAIR_EXISTING, accounts: [PAIR_EXISTING.accounts[0]] },
      onProgress: () => {},
    })
    // The transfer touches the new account, so it is not checked. Its single on the existing account is: one key, the expense.
    const sent = server.steps('check')
    expect(sent).toHaveLength(1)
    expect(sent[0].body.operations).toEqual([expect.objectContaining({ accountId: 'acc-a', toAccountId: null })])
  })
})

describe('finmap-client module', () => {
  it('is browser-safe: no server modules and no node built-ins', () => {
    const src = readFileSync(new URL('../../../lib/api/finmap-client.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/lib\/server/)
    expect(src).not.toMatch(/['"]node:/)
  })
})
