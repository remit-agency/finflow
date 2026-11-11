// Pure part of scripts/check-reports.ts (S12 rollout check). Unit-tested in Vitest.

/** What the check read for one company this month: counts and flags only. */
export interface ReportsCheck {
  accounts: number
  /** Rollup documents this month's Cash Flow and P&L read. */
  rollupDocs: number
  /** Operation documents the same two reports read from the operations; null when the month passed the read limit. */
  operationDocs: number | null
  aggregates: number
  /** The rollups and the operations gave the same totals and P&L rows; null when not compared (over the limit). */
  same: boolean | null
  /** The reconciliation of the month added up; null when an NBP rate was missing. */
  reconciled: boolean | null
}

export interface ReportsSummary {
  companies: number
  rollupDocs: number
  operationDocs: number
  aggregates: number
  overLimit: number
  different: number
  unreconciled: number
  unvalued: number
}

export function reportsCheckLine(orgId: string, c: ReportsCheck): string {
  const operations = c.operationDocs === null ? 'over the read limit' : `${c.operationDocs} operation document(s)`
  const same = c.same === null ? 'not compared' : c.same ? 'yes' : 'NO'
  const reconciled = c.reconciled === null ? 'no NBP rate' : c.reconciled ? 'yes' : 'NO'
  return `org ${orgId}: ${c.accounts} account(s), ${c.rollupDocs} rollup document(s), ${operations}, ${c.aggregates} aggregate(s), rollups = operations: ${same}, reconciled: ${reconciled}`
}

export function sumReportsChecks(checks: readonly ReportsCheck[]): ReportsSummary {
  return checks.reduce<ReportsSummary>(
    (s, c) => ({
      companies: s.companies + 1,
      rollupDocs: s.rollupDocs + c.rollupDocs,
      operationDocs: s.operationDocs + (c.operationDocs ?? 0),
      aggregates: s.aggregates + c.aggregates,
      overLimit: s.overLimit + (c.operationDocs === null ? 1 : 0),
      different: s.different + (c.same === false ? 1 : 0),
      unreconciled: s.unreconciled + (c.reconciled === false ? 1 : 0),
      unvalued: s.unvalued + (c.reconciled === null ? 1 : 0),
    }),
    { companies: 0, rollupDocs: 0, operationDocs: 0, aggregates: 0, overLimit: 0, different: 0, unreconciled: 0, unvalued: 0 },
  )
}

export function reportsSummaryLine(s: ReportsSummary): string {
  return `ALL: ${s.companies} company(ies), ${s.rollupDocs} rollup document(s), ${s.operationDocs} operation document(s), ${s.aggregates} aggregate(s); over the read limit: ${s.overLimit}, rollups != operations: ${s.different}, not reconciled: ${s.unreconciled}, no NBP rate: ${s.unvalued}`
}
