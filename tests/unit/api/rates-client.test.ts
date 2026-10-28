import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRate } from '@/lib/api/rates-client'

const fetchMock = vi.fn()

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchRate', () => {
  it('asks /api/rates with from, to and date and returns the rate and the table day', async () => {
    fetchMock.mockResolvedValue(json(200, { rate: 4.25, rateDate: '2026-10-27', from: 'EUR', to: 'PLN' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toEqual({ rate: 4.25, rateDate: '2026-10-27' })

    const [url] = fetchMock.mock.calls[0] as [string]
    const params = new URL(url, 'http://x').searchParams
    expect(url.startsWith('/api/rates?')).toBe(true)
    expect([...params.keys()].sort()).toEqual(['date', 'from', 'to'])
    expect(params.get('from')).toBe('EUR')
    expect(params.get('to')).toBe('PLN')
    expect(params.get('date')).toBe('2026-10-28')
  })

  it('is null when the server answers with an error status', async () => {
    fetchMock.mockResolvedValue(json(503, { error: 'provider_unavailable' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toBeNull()
  })

  it('is null for a body that is not a usable rate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { rate: 0, rateDate: '2026-10-27' })))
    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { rate: 4.2 })))
    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toBeNull()
  })

  it('lets an abort through, so a caller can tell it from a failed call', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRate('EUR', 'PLN', '2026-10-28', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
