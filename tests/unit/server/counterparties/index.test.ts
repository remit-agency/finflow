import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CounterpartyDeps } from '@/lib/server/counterparties/deps'
import { counterparties } from '@/lib/server/counterparties'
import { lookupNip } from '@/lib/server/counterparties/whitelist'
import { createCounterparty, updateCounterparty } from '@/lib/server/counterparties/write'
import { HttpError } from '@/lib/server/http-error'
import { enforceRateLimit, LOOKUP_LIMITS } from '@/lib/server/rate-limit-guard'

vi.mock('@/lib/server/firebase-admin', () => ({ getAdmin: () => ({ db: {} }) }))
vi.mock('@/lib/server/rate-limit-guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/rate-limit-guard')>('@/lib/server/rate-limit-guard')
  return { ...actual, enforceRateLimit: vi.fn(async () => {}) }
})
vi.mock('@/lib/server/counterparties/whitelist', () => ({
  lookupNip: vi.fn(async () => ({ found: false })),
}))
vi.mock('@/lib/server/counterparties/write', () => ({
  createCounterparty: vi.fn(async () => ({})),
  updateCounterparty: vi.fn(async () => ({})),
}))

function depsOf(call: unknown): CounterpartyDeps {
  return (call as unknown[])[0] as CounterpartyDeps
}

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockReset().mockResolvedValue(undefined)
  vi.mocked(lookupNip).mockReset().mockResolvedValue({ found: false })
  vi.mocked(createCounterparty).mockReset().mockResolvedValue({} as never)
  vi.mocked(updateCounterparty).mockReset().mockResolvedValue({} as never)
})

describe('counterparties service and the white list rate limit', () => {
  it('create: every white list question it asks counts against the lookup limit first', async () => {
    await counterparties.create('org1', 'alice', { name: 'A', ibans: [] })
    const deps = depsOf(vi.mocked(createCounterparty).mock.calls[0])
    expect(enforceRateLimit).not.toHaveBeenCalled()
    await deps.lookup('7740001454')
    expect(enforceRateLimit).toHaveBeenCalledWith('alice', 'lookup', LOOKUP_LIMITS)
    expect(lookupNip).toHaveBeenCalledWith('7740001454', expect.any(String))
  })

  it('update: every white list question it asks counts against the lookup limit first', async () => {
    await counterparties.update('org1', 'alice', 'id1', { nip: '7740001454' })
    const deps = depsOf(vi.mocked(updateCounterparty).mock.calls[0])
    await deps.lookup('7740001454')
    expect(enforceRateLimit).toHaveBeenCalledWith('alice', 'lookup', LOOKUP_LIMITS)
    expect(lookupNip).toHaveBeenCalledTimes(1)
  })

  it('a refused limit stops the white list question and propagates the 429', async () => {
    vi.mocked(enforceRateLimit).mockRejectedValue(new HttpError(429, 'rate_limited'))
    await counterparties.create('org1', 'alice', { name: 'A', ibans: [] })
    const deps = depsOf(vi.mocked(createCounterparty).mock.calls[0])
    await expect(deps.lookup('7740001454')).rejects.toMatchObject({ status: 429 })
    expect(lookupNip).not.toHaveBeenCalled()
  })

  it('lookup counts once, not twice', async () => {
    await counterparties.lookup('alice', '7740001454')
    expect(enforceRateLimit).toHaveBeenCalledTimes(1)
    expect(lookupNip).toHaveBeenCalledTimes(1)
  })
})
