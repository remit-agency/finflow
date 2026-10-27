import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { createCounterparty, duplicateOf, lookupNip, updateCounterparty } from '@/lib/api/counterparty-client'

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('createCounterparty', () => {
  it('posts the draft without empty optional fields and returns the counterparty', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const created = { id: 'c1', name: 'Acme', ibans: [], archived: false }
    fetchMock.mockResolvedValue(json(201, { counterparty: created }))
    expect(await createCounterparty('org 1', { name: 'Acme', ibans: [] })).toEqual(created)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/orgs/org%201/counterparties')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'Acme', ibans: [] })
  })

  it('includes the NIP and the address when given', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(201, { counterparty: {} }))
    await createCounterparty('o', { name: 'Acme', nip: '7740001454', ibans: ['61109010140000071219812874'], address: 'Płock' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Acme', nip: '7740001454', ibans: ['61109010140000071219812874'], address: 'Płock' })
  })

  it('exposes which field is a duplicate and of whom', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(409, { error: 'duplicate', field: 'nip', existingId: 'c9' }))
    const error = await createCounterparty('o', { name: 'A', nip: '7740001454', ibans: [] }).catch((e) => e)
    expect(error).toBeInstanceOf(LedgerApiError)
    expect(duplicateOf(error)).toEqual({ field: 'nip', existingId: 'c9' })
  })
})

describe('duplicateOf', () => {
  it('is null for other errors', () => {
    expect(duplicateOf(new LedgerApiError(409, 'limit'))).toBeNull()
    expect(duplicateOf(new Error('x'))).toBeNull()
    expect(duplicateOf(new LedgerApiError(409, 'duplicate', { error: 'duplicate', field: 'other' }))).toBeNull()
  })

  it('reads a duplicate without an existing id', () => {
    expect(duplicateOf(new LedgerApiError(409, 'duplicate', { error: 'duplicate', field: 'name' }))).toEqual({ field: 'name', existingId: undefined })
  })
})

describe('updateCounterparty', () => {
  it('patches the given fields only', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(200, { counterparty: { id: 'c1' } }))
    await updateCounterparty('o', 'c/1', { archived: true, nip: null })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/orgs/o/counterparties/c%2F1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ archived: true, nip: null })
  })
})

describe('lookupNip', () => {
  it('asks for the NIP and returns the answer', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const answer = { found: true, name: 'ORLEN', vatStatus: 'active', ibans: [], checkedOn: '2026-10-27' }
    fetchMock.mockResolvedValue(json(200, answer))
    expect(await lookupNip('o', '7740001454')).toEqual(answer)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/o/counterparties/lookup?nip=7740001454')
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })

  it('rejects with the server code', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(502, { error: 'lookup_unavailable' }))
    await expect(lookupNip('o', '7740001454')).rejects.toMatchObject({ status: 502, code: 'lookup_unavailable' })
  })
})
