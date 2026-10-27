import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { lookupNip } from '@/lib/server/counterparties/whitelist'

const fixtureText = (name: string) => readFileSync(resolve(process.cwd(), 'tests/fixtures/whitelist', name), 'utf8')
const json = (text: string, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'application/json' } })
const code = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return (e as CounterpartyError).code
  }
  return 'resolved'
}

describe('lookupNip', () => {
  it('asks the white list for the NIP and day and parses the answer', async () => {
    const fetchFn = vi.fn(async (_url: string) => json(fixtureText('found-active.json')))
    const result = await lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch, baseUrl: 'https://wl.example/' })
    expect(result).toMatchObject({ found: true, subject: { name: 'ORLEN SPÓŁKA AKCYJNA', vatStatus: 'active' } })
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://wl.example/api/search/nip/7740001454?date=2026-10-27')
  })

  it('answers found:false for an unknown NIP', async () => {
    const fetchFn = vi.fn(async () => json(fixtureText('not-found.json')))
    expect(await lookupNip('5252344078', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch })).toEqual({ found: false })
  })

  it('retries once after a network error', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(json(fixtureText('not-found.json')))
    expect(await lookupNip('5252344078', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch })).toEqual({ found: false })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('gives up after two network errors with lookup_unavailable', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    expect(await code(lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch }))).toBe('lookup_unavailable')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([500, 429, 400])('does not retry an HTTP %i and reports lookup_unavailable', async (status) => {
    const fetchFn = vi.fn(async () => json('{"message":"x"}', status))
    expect(await code(lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch }))).toBe('lookup_unavailable')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('reports lookup_unavailable for a body that is not JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>', { status: 200 }))
    expect(await code(lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch }))).toBe('lookup_unavailable')
  })

  it('takes the base URL from WL_API_BASE when no option is given', async () => {
    vi.stubEnv('WL_API_BASE', 'http://127.0.0.1:4010/')
    const fetchFn = vi.fn(async (_url: string) => json(fixtureText('not-found.json')))
    await lookupNip('5252344078', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch })
    expect(String(fetchFn.mock.calls[0][0]).startsWith('http://127.0.0.1:4010/api/search/nip/')).toBe(true)
  })
})
