import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backgroundBankDeps, banking } from '@/lib/server/banking'
import { POST } from '@/app/api/cron/bank-sync/route'

vi.mock('@/lib/server/banking', () => ({
  backgroundBankDeps: vi.fn(() => ({ marker: 'deps' })),
  banking: { runBackgroundSync: vi.fn() },
}))

const SECRET = 'a-long-random-secret-of-at-least-32-chars'
const SUMMARY = { slot: '2026-10-27#08', considered: 1, synced: 1, skipped: 0, failed: 0, rateLimited: 0, imported: 4 }

function call(authorization?: string): Promise<Response> {
  return POST(new Request('http://localhost:3000/api/cron/bank-sync', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} }))
}

beforeEach(() => {
  vi.stubEnv('BANK_CRON_SECRET', SECRET)
  vi.mocked(banking.runBackgroundSync).mockReset()
  vi.mocked(backgroundBankDeps).mockClear()
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
  })

  it('runs the refresh with person-less dependencies and returns the counts, not cached', async () => {
    vi.mocked(banking.runBackgroundSync).mockResolvedValue(SUMMARY)
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual(SUMMARY)
    expect(backgroundBankDeps).toHaveBeenCalledTimes(1)
    expect(banking.runBackgroundSync).toHaveBeenCalledWith({ marker: 'deps' })
  })

  it('answers 500 when the refresh itself breaks, so the job turns red', async () => {
    vi.mocked(banking.runBackgroundSync).mockRejectedValue(new Error('boom'))
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })
})
