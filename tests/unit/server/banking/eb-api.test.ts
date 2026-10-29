import { describe, expect, it, vi } from 'vitest'
import { BankError } from '@/lib/server/banking/errors'
import { classifyEbFailure, createEbApi } from '@/lib/server/banking/eb-api'

function api(responses: Array<{ status?: number; json?: unknown; text?: string } | Error>, psu?: { ip?: string; userAgent?: string }) {
  const calls: Array<{ url: string; headers: Record<string, string>; signal: AbortSignal | null | undefined }> = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), signal: init?.signal })
    const next = responses.shift()
    if (next === undefined) throw new Error('no more responses')
    if (next instanceof Error) throw next
    const status = next.status ?? 200
    return new Response(next.text ?? JSON.stringify(next.json ?? {}), { status })
  }) as unknown as typeof fetch
  return { eb: createEbApi({ base: 'https://eb.test', token: async () => 'tok', psu, fetchImpl }), calls }
}

describe('getSession', () => {
  it('normalizes accounts given as objects', async () => {
    const { eb, calls } = api([
      { json: { session_id: 's1', status: 'AUTHORIZED', psu_type: 'business', aspsp: { name: 'Millennium', country: 'PL' }, access: { valid_until: '2027-01-21T06:42:38.397000Z' }, accounts: ['u1'], accounts_data: [{ uid: 'u1', identification_hash: 'h1', identification_hashes: ['h1', 'h2'] }] } },
      { json: { uid: 'u1', account_id: { iban: 'PL61109010140000071219812874' }, name: 'Firmowe', currency: 'PLN' } },
    ])
    const s = await eb.getSession('s1')
    expect(calls[0].url).toBe('https://eb.test/sessions/s1')
    expect(calls[0].headers.Authorization).toBe('Bearer tok')
    expect(calls[1].url).toBe('https://eb.test/accounts/u1/details')
    // The real bank writes six fractional digits; the value must survive as it is (a rejected date would fall back to now + 90 days).
    expect(s).toEqual({ sessionId: 's1', institutionName: 'Millennium', institutionCountry: 'PL', psuType: 'business', validUntil: '2027-01-21T06:42:38.397000Z', accounts: [{ uid: 'u1', identificationHashes: ['h1', 'h2'], iban: 'PL61109010140000071219812874', currency: 'PLN', name: 'Firmowe' }] })
  })
  it('accepts accounts_data and plain uid strings; falls back to now + 90 days without valid_until', async () => {
    const { eb } = api([{ json: { aspsp: { name: 'B' }, accounts: ['u1'] } }, { json: {} }])
    const s = await eb.getSession('s2')
    expect(s.accounts).toEqual([{ uid: 'u1', identificationHashes: [], iban: null, currency: null, name: null }])
    expect(Date.parse(s.validUntil) - Date.now()).toBeGreaterThan(89 * 86_400_000)
    const { eb: eb2 } = api([{ json: { aspsp: { name: 'B' }, accounts_data: [{ uid: 'u9', identification_hash: 'x' }], accounts: ['u9'] } }, { json: { currency: 'EUR' } }])
    expect((await eb2.getSession('s3')).accounts[0]).toMatchObject({ uid: 'u9', currency: 'EUR', identificationHashes: ['x'] })
  })
  it('a failed details call fails the whole session read instead of returning half an account', async () => {
    const { eb } = api([{ json: { accounts: ['u1'] } }, { status: 429, text: '{}' }])
    await expect(eb.getSession('s4')).rejects.toMatchObject({ code: 'rate_limited' })
  })
})

describe('getTransactions / getBalances', () => {
  it('asks for booked operations from a day, with the continuation key, and sends the person headers', async () => {
    const { eb, calls } = api([{ json: { transactions: [{ entry_reference: 'r' }], continuation_key: 'next' } }, { json: { transactions: [] } }], { ip: '203.0.113.7', userAgent: 'UA/1' })
    const first = await eb.getTransactions('u 1', { dateFrom: '2026-10-01' })
    expect(first).toEqual({ transactions: [{ entry_reference: 'r' }], continuationKey: 'next' })
    expect(calls[0].url).toBe('https://eb.test/accounts/u%201/transactions?date_from=2026-10-01&transaction_status=BOOK')
    expect(calls[0].headers['psu-ip-address']).toBe('203.0.113.7')
    expect(calls[0].headers['psu-user-agent']).toBe('UA/1')
    const second = await eb.getTransactions('u 1', { dateFrom: '2026-10-01', continuationKey: 'next' })
    expect(second.continuationKey).toBeNull()
    expect(calls[1].url).toContain('continuation_key=next')
  })
  it('reads balances', async () => {
    const { eb } = api([{ json: { balances: [{ balance_type: 'CLBD', balance_amount: { amount: '1.00', currency: 'PLN' } }] } }])
    expect(await eb.getBalances('u1')).toHaveLength(1)
  })
})

describe('failures', () => {
  it.each([
    [429, '{}', 'rate_limited'],
    [400, 'ASPSP_RATE_LIMIT_EXCEEDED', 'rate_limited'],
    [401, '{"message":"Invalid JWT signature"}', 'bank_error'],
    [401, '{"error":"SESSION_EXPIRED"}', 'consent_expired'],
    [422, '{"message":"Session is closed"}', 'consent_expired'],
    [403, '{"message":"consent revoked"}', 'consent_expired'],
    [503, 'down', 'bank_unavailable'],
    [500, 'oops', 'bank_unavailable'],
    [400, '{"message":"bad date"}', 'bank_error'],
  ])('HTTP %s %s -> %s', (status, body, code) => {
    expect(classifyEbFailure(status as number, body as string)).toBe(code)
  })
  it('turns a failed call into a BankError and a network error into bank_unavailable', async () => {
    const { eb } = api([{ status: 429, text: '{}' }, new TypeError('fetch failed')])
    await expect(eb.getBalances('u1')).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(eb.getBalances('u1')).rejects.toBeInstanceOf(BankError)
  })
  it('every bank request carries a timeout signal, and a timed-out request is bank_unavailable', async () => {
    const { eb, calls } = api([{ json: { balances: [] } }, new DOMException('The operation was aborted due to timeout', 'TimeoutError')])
    await eb.getBalances('u1')
    expect(calls[0].signal).toBeInstanceOf(AbortSignal)
    await expect(eb.getBalances('u1')).rejects.toMatchObject({ code: 'bank_unavailable' })
  })
})

describe('background fetching', () => {
  it('sends no psu-* header when no person is given, and sends them when one is', async () => {
    const background = api([{ json: { balances: [] } }])
    await background.eb.getBalances('u1')
    expect(Object.keys(background.calls[0].headers).filter((h) => h.toLowerCase().startsWith('psu-'))).toEqual([])

    const online = api([{ json: { balances: [] } }], { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' })
    await online.eb.getBalances('u1')
    expect(online.calls[0].headers).toMatchObject({ 'psu-ip-address': '203.0.113.7', 'psu-user-agent': 'Mozilla/5.0' })
  })
})
