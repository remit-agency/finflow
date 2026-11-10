import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backgroundBankDeps, banking } from '@/lib/server/banking'
import { recurring } from '@/lib/server/recurring'
import { POST } from '@/app/api/cron/bank-sync/route'

vi.mock('@/lib/server/banking', () => ({
  backgroundBankDeps: vi.fn(() => ({ marker: 'deps' })),
  banking: { runBackgroundSync: vi.fn() },
}))
vi.mock('@/lib/server/recurring', () => ({ recurring: { cron: vi.fn() } }))

const SECRET = 'a-long-random-secret-of-at-least-32-chars'
const SUMMARY = { slot: '2026-10-27#08', considered: 1, synced: 1, skipped: 0, failed: 0, rateLimited: 0, imported: 4 }
const PLANS = { considered: 2, filled: 2, created: 3, skipped: 0, failed: 0 }

function call(authorization?: string): Promise<Response> {
  return POST(new Request('http://localhost:3000/api/cron/bank-sync', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} }))
}

beforeEach(() => {
  vi.stubEnv('BANK_CRON_SECRET', SECRET)
  vi.mocked(banking.runBackgroundSync).mockReset()
  vi.mocked(backgroundBankDeps).mockClear()
  vi.mocked(recurring.cron).mockReset()
  vi.mocked(recurring.cron).mockResolvedValue(PLANS)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/cron/bank-sync', () => {
  it('answers 503 and does nothing while no secret is configured', async () => {
    vi.stubEnv('BANK_CRON_SECRET', '')
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503)
    expect(banking.runBackgroundSync).not.toHaveBeenCalled()
    expect(recurring.cron).not.toHaveBeenCalled()
  })

  it('answers 503 for a secret shorter than 32 characters', async () => {
    vi.stubEnv('BANK_CRON_SECRET', 'short')
    expect((await call('Bearer short')).status).toBe(503)
    expect(banking.runBackgroundSync).not.toHaveBeenCalled()
  })

  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer nope'],
    ['the secret without Bearer', SECRET],
  ])('answers 401 with %s and does nothing', async (_name, header) => {
    const res = await call(header)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(banking.runBackgroundSync).not.toHaveBeenCalled()
    expect(recurring.cron).not.toHaveBeenCalled()
  })

  it('runs the bank refresh with person-less dependencies, then the planned payments, and returns both counts, not cached', async () => {
    vi.mocked(banking.runBackgroundSync).mockResolvedValue(SUMMARY)
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ ...SUMMARY, recurring: PLANS })
    expect(banking.runBackgroundSync).toHaveBeenCalledWith({ marker: 'deps' })
    const budget = vi.mocked(recurring.cron).mock.calls[0][0]
    expect(budget).toBeGreaterThan(0)
    expect(budget).toBeLessThanOrEqual(10_000)
  })

  it('gives the planned payments only what is left of the route time', async () => {
    vi.mocked(banking.runBackgroundSync).mockResolvedValue(SUMMARY)
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_050_000)
    await call(`Bearer ${SECRET}`)
    now.mockReturnValueOnce(2_000_000).mockReturnValueOnce(2_058_000)
    await call(`Bearer ${SECRET}`)
    now.mockRestore()
    expect(vi.mocked(recurring.cron).mock.calls.map((c) => c[0])).toEqual([5_000, 0])
  })

  it('answers 500 when the bank refresh breaks, so the job turns red; the planned payments still run', async () => {
    vi.mocked(banking.runBackgroundSync).mockRejectedValue(new Error('boom'))
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    expect(recurring.cron).toHaveBeenCalledTimes(1)
  })
})
