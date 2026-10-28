// Read-only guard for the S08 rollout: is every company ready for the journal? Never writes anything.
//   npm run check:journal                                      over the emulator when FIRESTORE_EMULATOR_HOST is set
//   npm run check:journal -- --project=finflow-e94b5           production (the flag is required; nothing is read without it)
//   --org=<id> limits the run to one company.
// For every company it
//   (a) compares transactions.count() with transactions.orderBy('createdAt').count(): Firestore leaves out
//       documents without the field, so a difference means operations the journal cannot list;
//   (b) for a company that has operations reads journal pages through readJournalPage (limit 50): unfiltered, only
//       planned, and for the company's first account. A missing composite index (the listing order, the account OR
//       query, the five balance aggregate indexes of firestore.indexes.json) answers FAILED_PRECONDITION with a link
//       to create it, which is printed as is.
// Exit code: 0 all clear, 1 a company is not ready or a query failed, 2 refused or bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { EMPTY_FILTERS, type JournalFilters } from '@/lib/domain/journal/filter'
import { toDay } from '@/lib/domain/ledger/days'
import { readJournalPage } from '@/lib/server/journal/read'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { accountsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { todayUtcDay } from '@/lib/utils/today'
import { assertReadinessTarget, parseCheckJournalArgs } from './lib/check-journal-args'

const PROJECT_ID = 'finflow-e94b5'
const EMULATOR_PROJECT_ID = 'demo-finflow'
const PAGE_LIMIT = 50

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

/** gRPC code 9 is FAILED_PRECONDITION: Firestore's answer to a query that needs an index (the message carries the creation link). */
function describeError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code
    const label = code === 9 ? 'FAILED_PRECONDITION' : code !== undefined ? `code ${String(code)}` : 'error'
    return `${label}: ${e.message}`
  }
  return 'error'
}

interface Countable {
  count: () => { get: () => Promise<{ data: () => { count: number } }> }
}

async function countOf(q: Countable): Promise<number> {
  return (await q.count().get()).data().count
}

/** A stub rate resolver is enough: the journal read never converts. */
function readOnlyDeps(db: Firestore): LedgerDeps {
  return {
    db,
    resolveRate: () => Promise.reject(new Error('the readiness check does not resolve rates')),
    now: () => new Date(),
    today: () => toDay(todayUtcDay()),
  }
}

interface Probe {
  label: string
  ok: boolean
  detail: string
}

interface OrgReport {
  operations: number
  /** Operations Firestore leaves out of an orderBy('createdAt') query. */
  withoutCreatedAt: number
  probes: Probe[]
}

async function checkOrg(db: Firestore, orgId: string): Promise<OrgReport> {
  const col = transactionsCol(db, orgId)
  const operations = await countOf(col)
  const ordered = await countOf(col.orderBy('createdAt'))
  const report: OrgReport = { operations, withoutCreatedAt: operations - ordered, probes: [] }
  if (operations === 0) return report

  const deps = readOnlyDeps(db)
  const firstAccount = (await accountsCol(db, orgId).select().orderBy('__name__').limit(1).get()).docs[0]?.id
  const probes: Array<{ label: string; filters: JournalFilters }> = [
    { label: 'unfiltered', filters: { ...EMPTY_FILTERS } },
    { label: 'status planned', filters: { ...EMPTY_FILTERS, status: 'planned' } },
  ]
  if (firstAccount) probes.push({ label: `account ${firstAccount}`, filters: { ...EMPTY_FILTERS, accountId: firstAccount } })
  else report.probes.push({ label: 'account filter', ok: true, detail: 'skipped: the company has no accounts' })

  for (const probe of probes) {
    try {
      const page = await readJournalPage(deps, orgId, { filters: probe.filters, cursor: null, limit: PAGE_LIMIT })
      report.probes.push({
        label: probe.label,
        ok: true,
        detail: `${page.rows.length} row(s), ${page.stats.docsRead} doc(s) read, ${page.stats.aggregates} aggregate(s)`,
      })
    } catch (e) {
      report.probes.push({ label: probe.label, ok: false, detail: describeError(e) })
    }
  }
  return report
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

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const notReady = new Set<string>()
  const errored: string[] = []
  let withOperations = 0
  for (const orgId of orgIds) {
    try {
      const r = await checkOrg(db, orgId)
      if (r.operations > 0) withOperations++
      if (r.withoutCreatedAt !== 0) {
        notReady.add(orgId)
        console.log(
          `org ${orgId}: NOT READY, ${r.withoutCreatedAt} of ${r.operations} operation(s) have no createdAt (count ${r.operations} vs orderBy(createdAt) ${r.operations - r.withoutCreatedAt})`,
        )
      }
      for (const p of r.probes.filter((x) => !x.ok)) {
        notReady.add(orgId)
        console.log(`org ${orgId}: journal read "${p.label}" FAILED (${p.detail})`)
      }
      if (!notReady.has(orgId) && r.operations > 0) {
        console.log(`org ${orgId}: ok (${r.operations} operation(s); ${r.probes.map((p) => `${p.label}: ${p.detail}`).join('; ')})`)
      }
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${describeError(e)})`)
      errored.push(orgId)
    }
  }
  console.log(
    `checked ${orgIds.length - errored.length} company(ies), ${withOperations} with operations; not ready: ${notReady.size}; errors: ${errored.length}`,
  )
  if (notReady.size > 0) console.error(`NOT READY (${notReady.size}): ${[...notReady].join(', ')}`)
  if (errored.length > 0) console.error(`failed companies (${errored.length}): ${errored.join(', ')}`)
  if (notReady.size === 0 && errored.length === 0) console.log('READY: no company listed. Nothing was written.')
  return notReady.size > 0 || errored.length > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
