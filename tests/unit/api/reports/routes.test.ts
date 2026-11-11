import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS } from '@/lib/domain/analytics-filter/filter'
import { ReportError } from '@/lib/domain/reports/errors'
import { reports } from '@/lib/server/reports'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { GET as balancesRoute } from '@/app/api/orgs/[orgId]/reports/balances/route'
import { GET as cashflowRoute } from '@/app/api/orgs/[orgId]/reports/cashflow/route'
import { GET as dashboardRoute } from '@/app/api/orgs/[orgId]/reports/dashboard/route'
import { GET as exportRoute } from '@/app/api/orgs/[orgId]/reports/export/route'
import { GET as plRoute } from '@/app/api/orgs/[orgId]/reports/pl/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/reports', () => ({
  reports: { cashflow: vi.fn(), pl: vi.fn(), balances: vi.fn(), dashboard: vi.fn(), exportFile: vi.fn() },
}))

const base = '/api/orgs/org-acme/reports'
const PERIOD = 'from=2026-01-01&to=2026-12-31'

function req(path: string, token: string | null = 'token-alice', extraCookie = ''): Request {
  const cookie = [token ? `__session=${token}` : '', extraCookie].filter((c) => c !== '').join('; ')
  return new Request(`http://localhost:3000${path}`, { method: 'GET', headers: cookie ? { Cookie: cookie } : {} })
}
const ctx = () => ({ params: Promise.resolve({ orgId: 'org-acme' }) })

type Call = { name: string; mock: keyof typeof reports; call: (token: string | null) => Promise<Response> }
const ROUTES: Call[] = [
  { name: 'GET /reports/cashflow', mock: 'cashflow', call: (t) => cashflowRoute(req(`${base}/cashflow?${PERIOD}`, t), ctx()) },
  { name: 'GET /reports/pl', mock: 'pl', call: (t) => plRoute(req(`${base}/pl?${PERIOD}`, t), ctx()) },
  { name: 'GET /reports/balances', mock: 'balances', call: (t) => balancesRoute(req(`${base}/balances?date=2026-10-31`, t), ctx()) },
  { name: 'GET /reports/dashboard', mock: 'dashboard', call: (t) => dashboardRoute(req(`${base}/dashboard`, t), ctx()) },
  { name: 'GET /reports/export', mock: 'exportFile', call: (t) => exportRoute(req(`${base}/export?report=cashflow&format=csv&${PERIOD}`, t), ctx()) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(reports)) vi.mocked(fn).mockReset()
  vi.mocked(reports.cashflow).mockResolvedValue({ kind: 'cashflow' } as never)
  vi.mocked(reports.pl).mockResolvedValue({ kind: 'pl' } as never)
  vi.mocked(reports.balances).mockResolvedValue({ date: '2026-10-31' } as never)
  vi.mocked(reports.dashboard).mockResolvedValue({ date: '2026-10-27' } as never)
  vi.mocked(reports.exportFile).mockResolvedValue({ body: '﻿Report\r\n', contentType: 'text/csv; charset=utf-8', filename: 'cashflow-2026-01-01_2026-12-31.csv' })
})

describe('authorization of every report route', () => {
  describe.each(ROUTES)('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(reports[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(reports[mock]).not.toHaveBeenCalled()
    })

    it('lets a viewer read, never cached', async () => {
      const res = await call('token-dave')
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })
  })
})

describe('parameters', () => {
  it('Cash Flow passes the parsed period and filters on', async () => {
    expect((await cashflowRoute(req(`${base}/cashflow?${PERIOD}&tg=vat&accounts=acc1`), ctx())).status).toBe(200)
    expect(reports.cashflow).toHaveBeenCalledWith('org-acme', { from: '2026-01-01', to: '2026-12-31', filters: { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'], accountIds: ['acc1'] } })
  })

  it('a bad parameter is 400 with its field, before any read', async () => {
    const cases: Array<[() => Promise<Response>, string]> = [
      [() => cashflowRoute(req(`${base}/cashflow?from=2026-01-01`), ctx()), 'to'],
      [() => plRoute(req(`${base}/pl?${PERIOD}&tg=a1,a1`), ctx()), 'tg'],
      [() => balancesRoute(req(`${base}/balances?date=2026-02-30`), ctx()), 'date'],
      [() => dashboardRoute(req(`${base}/dashboard?x=1`), ctx()), 'x'],
      [() => exportRoute(req(`${base}/export?report=cashflow&format=pdf&${PERIOD}`), ctx()), 'format'],
    ]
    for (const [call, field] of cases) {
      const res = await call()
      expect(res.status, field).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_input', field })
    }
    for (const fn of Object.values(reports)) expect(fn).not.toHaveBeenCalled()
  })

  it('too many operations is 422 with the cap', async () => {
    vi.mocked(reports.cashflow).mockRejectedValueOnce(new ReportError('too_many_operations', { cap: 10_000 }))
    const res = await cashflowRoute(req(`${base}/cashflow?${PERIOD}&tg=vat`), ctx())
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'too_many_operations', cap: 10_000 })
  })
})

describe('GET /reports/export', () => {
  it('a file with its type, name and BOM, in the language of the NEXT_LOCALE cookie, else Polish', async () => {
    const res = await exportRoute(req(`${base}/export?report=pl&format=xlsx&${PERIOD}`, 'token-alice', 'NEXT_LOCALE=en'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="cashflow-2026-01-01_2026-12-31.csv"')
    expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(reports.exportFile).toHaveBeenCalledWith('org-acme', 'pl', 'xlsx', { from: '2026-01-01', to: '2026-12-31', filters: EMPTY_ANALYTICS_FILTERS }, 'en')
    await exportRoute(req(`${base}/export?report=cashflow&format=csv&${PERIOD}`), ctx())
    expect(vi.mocked(reports.exportFile).mock.calls[1][4]).toBe('pl')
  })
})
