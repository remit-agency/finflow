import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTransaction } from '@/lib/api/journal-client'
import { LedgerApiError } from '@/lib/api/ledger-client'

const fetchMock = vi.fn()
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchTransaction', () => {
  it('returns the operation from the single-operation endpoint', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(200, { transaction: { id: 't 1', amountMinor: 5 } }))
    const signal = new AbortController().signal
    expect(await fetchTransaction('org1', 't 1', signal)).toEqual({ id: 't 1', amountMinor: 5 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/transactions/t%201')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal })
  })
  it('throws a LedgerApiError with status 404 when it is gone', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(404, { error: 'not_found' }))
    const err = await fetchTransaction('org1', 't1').catch((e) => e)
    expect(err).toBeInstanceOf(LedgerApiError)
    expect(err).toMatchObject({ status: 404, code: 'not_found' })
  })
})
