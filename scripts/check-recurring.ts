// Read-only check for the S11 rollout (planned payments). Per company it reads the overview and the match suggestions the
// way the app does, and it runs once every query shape S11 adds (the due series of the daily fill, the overdue count and
// list, the window of planned operations, the plan candidates and the bank days of the suggestions, the operations and the
// marks of one series), so a missing index shows up as FAILED_PRECONDITION with its creation link. Never writes anything.
//   npm run check:recurring                                   over the emulator when FIRESTORE_EMULATOR_HOST is set
//   npm run check:recurring -- --project=finflow-e94b5        production (the flag is required; nothing is read without it)
//   --org=<id> limits the run to one company.
// Prints counts only, never names, amounts or texts.
// Exit code: 0 everything read, 1 a read failed, 2 refused or bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { addDays, toDay } from '@/lib/domain/ledger/days'
import { transactionsCol } from '@/lib/server/ledger/paths'
import { seriesMarksQuery, seriesOpsQuery } from '@/lib/server/ledger/series'
import { dueSeriesQuery, readMatchSuggestions, readOverview } from '@/lib/server/recurring/read'
import { todayUtcDay } from '@/lib/utils/today'
import { assertReadinessTarget, parseCheckJournalArgs } from './lib/check-journal-args'
import { recurringCheckLine, sumRecurringChecks, type RecurringCheck } from './lib/check-recurring'

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

async function checkOrg(db: Firestore, orgId: string, today: string): Promise<RecurringCheck> {
  const deps = { db, today: () => today }
  const overview = await readOverview(deps, orgId)
  const matches = await readMatchSuggestions(deps, orgId)
  // The shapes the reads above may skip (no plan near today, no series), each once; an empty answer is fine.
  await seriesOpsQuery(db, orgId, '_probe', today).limit(1).get()
  await seriesMarksQuery(db, orgId, '_probe', today).limit(1).get()
  await transactionsCol(db, orgId).where('paymentDate', '>=', addDays(today, -13)).where('paymentDate', '<=', today).orderBy('paymentDate', 'desc').select().limit(1).get()
  return {
    series: overview.series.length,
    active: overview.series.filter((s) => s.status === 'active').length,
    paused: overview.series.filter((s) => s.status === 'paused').length,
    due: overview.series.filter((s) => s.dueOn !== undefined && s.dueOn <= today).length,
    overdue: overview.overdueCount,
    upcoming: overview.upcoming.length,
    pairs: matches.total,
    ambiguous: matches.ambiguous,
    truncated: overview.truncated || matches.truncated,
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
  const db = getFirestore()
  const today = toDay(todayUtcDay())

  let failedGlobal = false
  try {
    const due = await dueSeriesQuery(db, today).select().limit(1).get()
    console.log(`due series query: OK (${due.size} of at most 1 read)`)
  } catch (e) {
    console.error(`due series query: FAILED (${describeError(e)})`)
    failedGlobal = true
  }

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const checks: RecurringCheck[] = []
  const errored: string[] = []
  for (const orgId of orgIds) {
    try {
      const c = await checkOrg(db, orgId, today)
      checks.push(c)
      console.log(recurringCheckLine(orgId, c))
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${describeError(e)})`)
      errored.push(orgId)
    }
  }
  console.log(recurringCheckLine('ALL', sumRecurringChecks(checks)))
  if (errored.length > 0) console.error(`failed companies (${errored.length}): ${errored.join(', ')}`)
  if (errored.length === 0 && !failedGlobal) console.log('DONE: every query ran. Nothing was written.')
  return errored.length > 0 || failedGlobal ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
