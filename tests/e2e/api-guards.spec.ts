import { test, expect } from '@playwright/test'

// S00 spec, readiness criterion 4. No emulators needed: every request must be rejected
// before the route touches Firestore or Enable Banking.
test.describe('API guards', () => {
  test('test backdoors are gone (404)', async ({ request }) => {
    expect((await request.get('/api/test/auth?email=a%40b.c&password=x')).status()).toBe(404)
    expect((await request.get('/test-login')).status()).toBe(404)
  })

  test('Enable Banking routes require a session cookie (401)', async ({ request }) => {
    const session = await request.post('/api/enablebanking/session', {
      data: { aspspName: 'Bank Millennium', aspspCountry: 'PL', orgId: 'victim-org' },
    })
    expect(session.status()).toBe(401)
    expect((await request.get('/api/enablebanking/institutions?country=PL')).status()).toBe(401)
    expect((await request.get('/api/enablebanking/accounts?sessionId=s&orgId=victim-org')).status()).toBe(401)
  })

  // S05: every ledger write endpoint refuses a request without a session cookie, before it reads any data.
  test('ledger write endpoints require a session cookie (401)', async ({ request }) => {
    const origin = { Origin: 'http://localhost:3000' }
    const calls: { method: 'POST' | 'PATCH' | 'DELETE'; path: string; data?: object }[] = [
      { method: 'POST', path: '/api/orgs/x/transactions', data: {} },
      { method: 'PATCH', path: '/api/orgs/x/transactions/t', data: {} },
      { method: 'DELETE', path: '/api/orgs/x/transactions/t' },
      { method: 'POST', path: '/api/orgs/x/accounts', data: {} },
      { method: 'PATCH', path: '/api/orgs/x/accounts/a', data: {} },
      { method: 'DELETE', path: '/api/orgs/x/accounts/a' },
      { method: 'PATCH', path: '/api/orgs/x', data: {} },
      { method: 'POST', path: '/api/orgs/x/ledger/rebuild', data: {} },
    ]
    for (const { method, path, data } of calls) {
      const res = await request.fetch(path, { method, headers: origin, data })
      expect(res.status(), `${method} ${path}`).toBe(401)
    }
  })

  test('Enable Banking callback rejects a forged state before exchanging the code (400)', async ({ request }) => {
    // The pre-S00 format: unsigned base64url JSON with just an orgId.
    const forged = Buffer.from(JSON.stringify({ orgId: 'victim-org' })).toString('base64url')
    const res = await request.get(`/api/enablebanking/callback?code=fake-code&state=${forged}`, { maxRedirects: 0 })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid state' })
  })
})
