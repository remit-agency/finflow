import 'server-only'
import type { ExportFormat, ReportKind, ReportQuery } from '@/lib/domain/reports/types'
import type { Locale } from '@/lib/i18n/config'
import { ledgerDeps } from '@/lib/server/ledger'
import { readBalances, readDashboard } from './balances'
import { reportFile } from './file'
import { readCashFlowReport, readPLReport } from './read'

/**
 * The reports (S12) bound to the production Firestore, NBP rates and the Warsaw clock. They read the ledger and write nothing
 * of it; a report may fetch NBP tables the resolver has not cached yet (it writes them to its `fxTables` cache, S04), so the
 * routes count each user's requests against REPORT_LIMITS and a request asks NBP for the month tables of at most MAX_RATE_MONTHS.
 */
export const reports = {
  cashflow: async (orgId: string, query: ReportQuery) => (await readCashFlowReport(ledgerDeps(), orgId, query)).report,
  pl: async (orgId: string, query: ReportQuery) => (await readPLReport(ledgerDeps(), orgId, query)).report,
  balances: async (orgId: string, date: string) => (await readBalances(ledgerDeps(), orgId, date)).report,
  dashboard: async (orgId: string) => (await readDashboard(ledgerDeps(), orgId)).report,
  exportFile: async (orgId: string, kind: ReportKind, format: ExportFormat, query: ReportQuery, locale: Locale) => {
    const read = kind === 'cashflow' ? await readCashFlowReport(ledgerDeps(), orgId, query) : await readPLReport(ledgerDeps(), orgId, query)
    return reportFile(read.report, read.context, format, locale)
  },
}
