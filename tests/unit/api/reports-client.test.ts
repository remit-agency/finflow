import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { downloadReport, fetchBalances, fetchCashFlow, fetchDashboard, fetchPL, viewOfFailure } from '@/lib/api/reports-client'
import { EMPTY_ANALYTICS_FILTERS } from '@/lib/domain/analytics-filter/filter'
import { ReportError } from '@/lib/domain/reports/errors'
import type { ReportQuery } from '@/lib/domain/reports/types'
import { downloadBlob } from '@/lib/utils/download'

vi.mock('@/lib/utils/download', () => ({ downloadBlob: vi.fn() }))

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const Q: ReportQuery = { from: '2026-01-01', to: '2026-12-31', filters: { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] } }

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(downloadBlob).mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reports client', () => {
  it('asks the report routes with the period and the filters, same-origin', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'cashflow' }))
    await fetchCashFlow('org 1', Q)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org%201/reports/cashflow?from=2026-01-01&to=2026-12-31&tg=vat')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
    fetchMock.mockResolvedValue(json({ kind: 'pl' }))
    await fetchPL('org1', { ...Q, filters: EMPTY_ANALYTICS_FILTERS })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/orgs/org1/reports/pl?from=2026-01-01&to=2026-12-31')
    fetchMock.mockResolvedValue(json({ date: '2026-10-31' }))
    await fetchBalances('org1', '2026-10-31')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/orgs/org1/reports/balances?date=2026-10-31')
    fetchMock.mockResolvedValue(json({ date: '2026-10-27' }))
    await fetchDashboard('org1')
    expect(fetchMock.mock.calls[3][0]).toBe('/api/orgs/org1/reports/dashboard')
  })

  it('a period the parser refuses is its own view, and the view says why: the end before the start, or a period too long', () => {
    expect(viewOfFailure(new ReportError('invalid_input', { field: 'to', reason: 'order' }))).toEqual({ status: 'invalid', reason: 'order' })
    expect(viewOfFailure(new ReportError('invalid_input', { field: 'to', reason: 'too_long' }))).toEqual({ status: 'invalid', reason: 'too_long' })
    // A refusal that names no period reason is not a period notice.
    expect(viewOfFailure(new ReportError('invalid_input', { field: 'types' }))).toEqual({ status: 'error' })
  })

  it('a refusal is a LedgerApiError with its code and details; the read limit becomes its own view', async () => {
    fetchMock.mockResolvedValue(json({ error: 'too_many_operations', cap: 10_000 }, 422))
    const e = await fetchCashFlow('org1', Q).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(LedgerApiError)
    expect(e).toMatchObject({ status: 422, code: 'too_many_operations', details: { cap: 10_000 } })
    expect(viewOfFailure(e)).toEqual({ status: 'too_large', cap: 10_000 })
    // An NBP refusal of the old kind is not a state of the report any more: it is an error.
    expect(viewOfFailure(new LedgerApiError(422, 'too_many_rates', { cap: 400 }))).toEqual({ status: 'error' })
    expect(viewOfFailure(new LedgerApiError(500, 'internal'))).toEqual({ status: 'error' })
    expect(viewOfFailure(new TypeError('offline'))).toEqual({ status: 'error' })
  })

  it('the export asks the server for the file and saves it under the name the page gives', async () => {
    fetchMock.mockResolvedValue(new Response('file', { status: 200 }))
    await downloadReport('org1', 'pl', 'xlsx', Q, 'pl-current-year.xlsx')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/reports/export?report=pl&format=xlsx&from=2026-01-01&to=2026-12-31&tg=vat')
    expect(vi.mocked(downloadBlob).mock.calls[0][0]).toBe('pl-current-year.xlsx')
    fetchMock.mockResolvedValue(json({ error: 'too_many_operations', cap: 10_000 }, 422))
    await expect(downloadReport('org1', 'pl', 'csv', Q, 'x.csv')).rejects.toBeInstanceOf(LedgerApiError)
    expect(downloadBlob).toHaveBeenCalledTimes(1)
  })
})
