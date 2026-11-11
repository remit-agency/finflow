// The readers of the report hooks (S12). A period the parser refuses must come back as a rejection the page can show, never as
// a synchronous throw inside the effect (which crashed the page to the error boundary). The hook's render is not tested here:
// the project has no DOM test environment for React.
import { describe, expect, it, vi } from 'vitest'
import { reportQueryToParams } from '@/lib/domain/reports/query'
import { ReportError } from '@/lib/domain/reports/errors'
import { EMPTY_ANALYTICS_FILTERS } from '@/lib/domain/analytics-filter/filter'
import { readCashFlowOf, readPLOf } from '@/lib/hooks/useReports'

vi.mock('@/lib/api/reports-client', () => ({
  fetchCashFlow: vi.fn(),
  fetchPL: vi.fn(),
  fetchBalances: vi.fn(),
  fetchDashboard: vi.fn(),
  viewOfFailure: vi.fn(),
}))

// Nine years and a half: longer than the 3 660 days a report covers.
const TOO_LONG = reportQueryToParams({ from: '2016-01-01', to: '2026-06-30', filters: EMPTY_ANALYTICS_FILTERS }).toString()
const key = (params: string) => `org-acme|${params}`

describe('report readers of the hooks', () => {
  // The call itself must return a promise: a synchronous throw would escape the effect and crash the page.
  it('a period over the report length rejects with the parser refusal, without throwing synchronously', async () => {
    const signal = new AbortController().signal
    const cashFlow = readCashFlowOf(key(TOO_LONG), signal)
    await expect(cashFlow).rejects.toBeInstanceOf(ReportError)
    const pl = readPLOf(key(TOO_LONG), signal)
    await expect(pl).rejects.toBeInstanceOf(ReportError)
  })
})
