// A stand-in for the Enable Banking API for the Playwright run: the app server is started with EB_API_BASE pointing
// here, so no test ever calls the real bank. The answers mimic the shapes the real bank sends (S09 spike, spec
// "Результати спайку"): a session with uids and hashes only, the account details for the IBAN, interim booked balance,
// booked operations with `entry_reference`, and a `continuation_key` between pages.
//   Session e2e-session -> one account e2e-acc-1 (Firmowe, PLN), balance 1500.00, three operations: +2000, -300, -200
//   The operations are dated relative to the server clock (UTC), so they are never in the future and always inside the
//   default 90-day window. `date_from` is ignored, as in the fake bank of the spec.
import http from 'node:http'

const PORT = 4011

const dayOffset = (n) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const SESSION = (now) => ({
  session_id: 'e2e-session',
  status: 'AUTHORIZED',
  psu_type: 'business',
  aspsp: { name: 'Fake Bank', country: 'PL' },
  access: { valid_until: new Date(now.getTime() + 90 * 86_400_000).toISOString() },
  accounts: ['e2e-acc-1'],
  accounts_data: [{ uid: 'e2e-acc-1', identification_hash: 'e2e-hash-1', identification_hashes: ['e2e-hash-1'] }],
})

const DETAILS = { uid: 'e2e-acc-1', account_id: { iban: 'PL61109010140000071219812874' }, name: 'Firmowe', currency: 'PLN' }

const BALANCES = { balances: [{ name: 'Saldo', balance_type: 'ITBD', balance_amount: { amount: '1500.00', currency: 'PLN' } }] }

function operation(ref, indicator, amount, daysBack, party, remittance) {
  const day = dayOffset(-daysBack)
  return {
    entry_reference: ref,
    status: 'BOOK',
    transaction_amount: { amount, currency: 'PLN' },
    credit_debit_indicator: indicator,
    booking_date: day,
    value_date: null,
    transaction_id: null,
    creditor: indicator === 'DBIT' ? { name: party } : null,
    debtor: indicator === 'CRDT' ? { name: party } : null,
    remittance_information: [remittance],
  }
}

const PAGE_1 = {
  transactions: [
    operation('e2e-r1', 'CRDT', '2000.00', 10, 'Klient Sp. z o.o.', 'Faktura 1/2026'),
    operation('e2e-r2', 'DBIT', '300.00', 5, 'Landlord', 'Czynsz'),
  ],
  continuation_key: 'page2',
}

const PAGE_2 = {
  transactions: [operation('e2e-r3', 'DBIT', '200.00', 2, 'Orlen', 'Paliwo')],
  continuation_key: null,
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/health') {
      res.end('ok')
      return
    }
    // Any Authorization header is accepted: the tests do not check the JWT, only that it is sent.
    if (req.method !== 'GET') return json(res, 405, { message: 'method not allowed' })
    const path = url.pathname
    if (path === '/sessions/e2e-session') return json(res, 200, SESSION(new Date()))
    if (path === '/accounts/e2e-acc-1/details') return json(res, 200, DETAILS)
    if (path === '/accounts/e2e-acc-1/balances') return json(res, 200, BALANCES)
    if (path === '/accounts/e2e-acc-1/transactions') {
      const key = url.searchParams.get('continuation_key')
      if (key === null) return json(res, 200, PAGE_1)
      if (key === 'page2') return json(res, 200, PAGE_2)
      return json(res, 400, { message: 'unknown continuation key' })
    }
    return json(res, 404, { message: 'not found' })
  })
  .listen(PORT, '127.0.0.1')
