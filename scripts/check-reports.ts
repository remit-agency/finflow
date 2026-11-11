// Read-only check for the S12 rollout (server reports). Per company it builds this month's Cash Flow and P&L from the
// rollups and from the operations, the balances of yesterday and the dashboard, the way the routes do, and runs once each
// query shape S12 adds (operations by accrual day and by accrual period, the count of the payments), so a missing index
// shows up as FAILED_PRECONDITION with its creation link. Rates come through a read-only view of the NBP cache: nothing is
// written, not even fxTables.
//   npm run check:reports                                   over the emulator when FIRESTORE_EMULATOR_HOST is set
//   npm run check:reports -- --project=finflow-e94b5        production (the flag is required; nothing is read without it)
//   --org=<id> limits the run to one company.
// Prints counts only, never names or amounts. Exit code: 0 everything read, 1 a read failed, 2 refused or bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { EMPTY_ANALYTICS_FILTERS } from '@/lib/domain/analytics-filter/filter'
import { addDays, monthBounds, monthOf, toDay } from '@/lib/domain/ledger/days'
import { ReportError } from '@/lib/domain/reports/errors'
import type { ReportQuery } from '@/lib/domain/reports/types'
import { fetchNbpTables } from '@/lib/server/fx/nbp'
import { createResolver } from '@/lib/server/fx/resolver'
import { firestoreFxStore } from '@/lib/server/fx/store'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { readBalances, readDashboard } from '@/lib/server/reports/balances'
import { accrualDaysQuery, accrualPeriodsQuery, paymentsQuery, readCashFlowReport, readPLReport } from '@/lib/server/reports/read'
import { todayUtcDay } from '@/lib/utils/today'
import { assertReadinessTarget, parseCheckJournalArgs } from './lib/check-journal-args'
import { reportsCheckLine, reportsSummaryLine, sumReportsChecks, type ReportsCheck } from './lib/check-reports'
import { readOnlyFxStore } from './lib/readonly-fx-store'

const PROJECT_ID = 'finflow-e94b5'
const EMULATOR_PROJECT_ID = 'demo-finflow'

function fail(message: string, code: number): never {
  console.error(message)
  process.exit(code)
}

function credential() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return applicationDefault()
  const dir = path.resolve('.secrets')
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /^finflow-.*-firebase-adminsdk-.*\.json$/.test(f)) : undefined
  if (!file) fail('No credentials: set GOOGLE_APPLICATION_CREDENTIALS or put the service-account JSON in .secrets/.', 2)
  return cert(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code
    return `${code !== undefined ? `code ${String(code)}` : 'error'}: ${e.message}`
  }
  return 'error'
}

/** A report over the read limit is an answer here (counted), not a failure. */
async function unlessOverLimit<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read
  } catch (e) {
    if (e instanceof ReportError && e.code === 'too_many_operations') return null
    throw e
  }
}

async function checkOrg(deps: LedgerDeps, orgId: string): Promise<ReportsCheck> {
  const today = deps.today()
  const month: ReportQuery = { from: `${monthOf(today)}-01`, to: monthBounds(monthOf(today)).last, filters: EMPTY_ANALYTICS_FILTERS }
  const cashFlow = await readCashFlowReport(deps, orgId, month)
  const pl = await readPLReport(deps, orgId, month)
  const cashFlowOps = await unlessOverLimit(readCashFlowReport(deps, orgId, month, { source: 'operations' }))
  const plOps = await unlessOverLimit(readPLReport(deps, orgId, month, { source: 'operations' }))
  const balances = await readBalances(deps, orgId, addDays(today, -1))
  await readDashboard(deps, orgId)
  // The shapes the reads above may not reach, each once; an empty answer is fine.
  await accrualDaysQuery(deps.db, orgId, month.from, month.to).select().limit(1).get()
  await accrualPeriodsQuery(deps.db, orgId, month.from).select().limit(1).get()
  await paymentsQuery(deps.db, orgId, month.from, month.to).count().get()
  const compared = cashFlowOps !== null && plOps !== null
  const same = compared
    ? JSON.stringify([cashFlow.report.totals, pl.report.totals, pl.report.rows]) === JSON.stringify([cashFlowOps.report.totals, plOps.report.totals, plOps.report.rows])
    : null
  const discrepancy = cashFlow.report.reconciliation.discrepancyBase
  return {
    accounts: balances.report.accounts.length,
    rollupDocs: cashFlow.stats.rollups + pl.stats.rollups,
    operationDocs: compared ? cashFlowOps.stats.operations + plOps.stats.operations : null,
    aggregates: cashFlow.stats.aggregates + pl.stats.aggregates + (cashFlowOps?.stats.aggregates ?? 0) + (plOps?.stats.aggregates ?? 0) + balances.stats.aggregates,
    same,
    reconciled: discrepancy === null ? null : discrepancy === 0,
  }
}

async function main(): Promise<number> {
  const parsed = parseCheckJournalArgs(process.argv.slice(2))
  if (!parsed.ok) fail(parsed.message, 2)
  const { org, raw } = parsed.args

  const target = assertReadinessTarget({ emulator: !!process.env.FIRESTORE_EMULATOR_HOST, args: raw })
  if (!target.ok) fail(target.message, 2)

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: EMULATOR_PROJECT_ID })
    console.log(`target: Firestore EMULATOR (project ${EMULATOR_PROJECT_ID})`)
  } else {
    initializeApp({ credential: credential(), projectId: PROJECT_ID })
    console.log(`target: PRODUCTION (project ${PROJECT_ID}), read-only`)
  }
  const db: Firestore = getFirestore()
  const today = toDay(todayUtcDay())
  const resolveRate = createResolver({
    store: readOnlyFxStore(firestoreFxStore(db)),
    fetchTables: (first, last) => fetchNbpTables(first, last),
    now: () => Date.now(),
    today: () => today,
  })
  const deps: LedgerDeps = { db, resolveRate, now: () => new Date(), today: () => today }

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const checks: ReportsCheck[] = []
  const errored: string[] = []
  for (const orgId of orgIds) {
    try {
      const c = await checkOrg(deps, orgId)
      checks.push(c)
      console.log(reportsCheckLine(orgId, c))
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${describeError(e)})`)
      errored.push(orgId)
    }
  }
  const summary = sumReportsChecks(checks)
  console.log(reportsSummaryLine(summary))
  if (summary.different > 0 || summary.unreconciled > 0) console.log('WARN: run verifyLedger (POST /api/orgs/{org}/ledger/rebuild?apply=0) for the companies marked NO.')
  if (errored.length > 0) console.error(`failed companies (${errored.length}): ${errored.join(', ')}`)
  else console.log('DONE: every query ran. Nothing was written.')
  return errored.length > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
