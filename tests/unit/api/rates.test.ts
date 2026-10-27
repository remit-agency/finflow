import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { GET } from '@/app/api/rates/route'
import { resolveRate } from '@/lib/server/fx'
import { FxError } from '@/lib/server/fx/types'
import { HttpError } from '@/lib/server/http-error'
import { enforceRateLimit, RATES_LIMITS } from '@/lib/server/rate-limit-guard'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/fx', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/fx')>('@/lib/server/fx')
  return { ...actual, resolveRate: vi.fn() }
})
vi.mock('@/lib/server/rate-limit-guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/rate-limit-guard')>('@/lib/server/rate-limit-guard')
  return { ...actual, enforceRateLimit: vi.fn(async () => {}) }
})

const SNAPSHOT = {
  rate: 4.4026,
  from: 'EUR',
  to: 'PLN',
  requestedDate: '2026-10-27',
  rateDate: '2026-10-26',
  tableNo: '208/A/NBP/2026',
  source: 'NBP_A',
  final: false,
}

function req(query: string, token: string | null = 'token-alice'): Request {
  return new Request(`http://localhost:3000/api/rates${query}`, {
    headers: token ? { Cookie: `__session=${token}` } : {},
  })
}

describe('GET /api/rates', () => {
  beforeEach(() => {
    resetFakeAdmin()
    vi.mocked(resolveRate).mockReset().mockResolvedValue(SNAPSHOT as never)
    vi.mocked(enforceRateLimit).mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('401 without a session and does not resolve anything', async () => {
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27', null))
    expect(res.status).toBe(401)
    expect(resolveRate).not.toHaveBeenCalled()
  })

  it('counts a valid request against the caller rates limit', async () => {
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27'))
    expect(res.status).toBe(200)
    expect(enforceRateLimit).toHaveBeenCalledWith('user-alice', 'rates', RATES_LIMITS)
  })

  it('answers 429 when the caller is over the limit and asks NBP nothing', async () => {
    vi.mocked(enforceRateLimit).mockRejectedValue(new HttpError(429, 'rate_limited'))
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27'))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(resolveRate).not.toHaveBeenCalled()
  })

  it('does not count a request with bad parameters', async () => {
    expect((await GET(req('?from=EUR'))).status).toBe(400)
    expect(enforceRateLimit).not.toHaveBeenCalled()
  })

  it('200 with the snapshot and a short private cache', async () => {
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(SNAPSHOT)
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(resolveRate).toHaveBeenCalledWith('EUR', 'PLN', '2026-10-27')
  })

  it.each([
    ['a missing param', '?from=EUR&to=PLN'],
    ['an extra param', '?from=EUR&to=PLN&date=2026-10-27&x=1'],
    ['a repeated param', '?from=EUR&from=USD&to=PLN&date=2026-10-27'],
    ['a lowercase code', '?from=eur&to=PLN&date=2026-10-27'],
    ['a bad date', '?from=EUR&to=PLN&date=2026-02-30'],
  ])('400 invalid_params for %s', async (_label, query) => {
    const res = await GET(req(query))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_params' })
    expect(resolveRate).not.toHaveBeenCalled()
  })

  it.each([
    ['unsupported_currency', 404],
    ['no_rate_before', 404],
    ['invalid_params', 400],
    ['provider_unavailable', 503],
  ] as const)('maps %s to %i without leaking details', async (code, status) => {
    vi.mocked(resolveRate).mockRejectedValue(new FxError(code))
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27'))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })

  it('500 internal for an unexpected error', async () => {
    vi.mocked(resolveRate).mockRejectedValue(new Error('boom with secrets'))
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })
})
