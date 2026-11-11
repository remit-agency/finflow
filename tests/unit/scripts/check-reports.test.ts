import { describe, expect, it } from 'vitest'
import { reportsCheckLine, reportsSummaryLine, sumReportsChecks, type ReportsCheck } from '@/scripts/lib/check-reports'

const ok: ReportsCheck = { accounts: 3, rollupDocs: 40, operationDocs: 120, aggregates: 30, same: true, reconciled: true }
const capped: ReportsCheck = { accounts: 9, rollupDocs: 400, operationDocs: null, aggregates: 70, same: null, reconciled: false }
const unvalued: ReportsCheck = { accounts: 2, rollupDocs: 10, operationDocs: 15, aggregates: 12, same: false, reconciled: null }

describe('check:reports lines', () => {
  it('one line per company: counts only, never names or amounts', () => {
    expect(reportsCheckLine('org1', ok)).toBe('org org1: 3 account(s), 40 rollup document(s), 120 operation document(s), 30 aggregate(s), rollups = operations: yes, reconciled: yes')
    expect(reportsCheckLine('org2', capped)).toBe('org org2: 9 account(s), 400 rollup document(s), over the read limit, 70 aggregate(s), rollups = operations: not compared, reconciled: NO')
    expect(reportsCheckLine('org3', unvalued)).toBe('org org3: 2 account(s), 10 rollup document(s), 15 operation document(s), 12 aggregate(s), rollups = operations: NO, reconciled: no NBP rate')
  })

  it('the summary counts the companies that need a look', () => {
    expect(sumReportsChecks([ok, capped, unvalued])).toEqual({ companies: 3, rollupDocs: 450, operationDocs: 135, aggregates: 112, overLimit: 1, different: 1, unreconciled: 1, unvalued: 1 })
    expect(reportsSummaryLine(sumReportsChecks([ok]))).toBe(
      'ALL: 1 company(ies), 40 rollup document(s), 120 operation document(s), 30 aggregate(s); over the read limit: 0, rollups != operations: 0, not reconciled: 0, no NBP rate: 0',
    )
  })
})
