// S12 measurement (AGENTS.md «Performance»), on the Firestore EMULATOR only: one synthetic company written through the
// ledger, then the browser approach the reports replace (the client read every operation document of the company) against
// the server reports, each twice: cold (the first call in this process) and warm (the second). Never touches production.
//   npx firebase emulators:exec --only firestore --project demo-finflow "node --conditions=react-server --import tsx scripts/measure-reports.ts --ops=3000"
// One line per workflow and phase: documents read, aggregate queries, response bytes (UTF-8 JSON), elapsed ms, CPU ms of this
// process and its peak resident memory (MB). Emulator timings are estimates, not production timings.
import { performance } from 'node:perf_hooks'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { EMPTY_ANALYTICS_FILTERS } from '@/lib/domain/analytics-filter/filter'
import { addDays, monthBounds, monthOf, toDay } from '@/lib/domain/ledger/days'
import { accountToDoc } from '@/lib/domain/ledger/doc'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { ReportError } from '@/lib/domain/reports/errors'
import { REPORT_SCAN_CAP, type ReportQuery } from '@/lib/domain/reports/types'
import { tagToDoc } from '@/lib/domain/tags/doc'
import { tagNameKey } from '@/lib/domain/tags/keys'
import type { RateSnapshot } from '@/lib/server/fx/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { transactionsCol } from '@/lib/server/ledger/paths'
import { createTransaction } from '@/lib/server/ledger/write'
import { readBalances, readDashboard } from '@/lib/server/reports/balances'
import { readCashFlowReport, readPLReport, type ReportReadStats } from '@/lib/server/reports/read'
import { todayUtcDay } from '@/lib/utils/today'

const ORG = 'measure-s12'
const UID = 'measure'

function fail(message: string, code: number): never {
  console.error(message)
  process.exit(code)
}

function opsArg(argv: readonly string[]): number {
  const raw = argv.find((a) => a.startsWith('--ops='))
  const n = raw === undefined ? 3000 : Number(raw.slice('--ops='.length))
  if (!Number.isInteger(n) || n < 1 || n > 20_000) fail('--ops must be a whole number from 1 to 20000', 2)
  return n
}

/** mulberry32: the same company on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** EUR at 4.30 every day: this measures reads, not NBP. */
const fixedRate: LedgerDeps['resolveRate'] = async (from, to, date): Promise<RateSnapshot> => {
  const same = from === to
  return { rate: same ? 1 : 4.3, from, to, requestedDate: date, rateDate: same ? date : addDays(date, -1), tableNo: same ? null : 'M/2026', source: same ? 'identity' : 'NBP_A', final: true }
}

/** 4 accounts (one in EUR), 6 income and 6 expense categories, the tag «VAT» excluding from analytics; `count` operations over 13 months. */
async function seed(db: Firestore, deps: LedgerDeps, count: number, today: string): Promise<void> {
  await db.doc(`organizations/${ORG}`).set({ name: 'Measure', currency: 'PLN', ownerId: UID, plan: 'trial' })
  const accounts = [['main', 'PLN'], ['cash', 'PLN'], ['card', 'PLN'], ['eur', 'EUR']] as const
  for (const [id, currency] of accounts) {
    const doc = accountToDoc({ id, name: id, type: 'bank', currency, color: '#00c896', openingMinor: 10_000_000, balanceMinor: 10_000_000 })
    await db.doc(`organizations/${ORG}/accounts/${id}`).set({ ...doc, orgId: ORG })
  }
  const income = ['in1', 'in2', 'in3', 'in4', 'in5', 'in6']
  const expense = ['ex1', 'ex2', 'ex3', 'ex4', 'ex5', 'ex6']
  for (const id of income) await db.doc(`organizations/${ORG}/categories/${id}`).set({ orgId: ORG, name: id, type: 'income', color: '#000000' })
  for (const id of expense) await db.doc(`organizations/${ORG}/categories/${id}`).set({ orgId: ORG, name: id, type: 'expense', color: '#000000' })
  const tag = tagToDoc({ id: 'vat', name: 'VAT', color: 'slate', excludeFromAnalytics: true, archived: false, recalcPending: false })
  await db.doc(`organizations/${ORG}/tags/vat`).set({ ...tag, orgId: ORG })
  await db.doc(`organizations/${ORG}/tagKeys/${tagNameKey('VAT')}`).set({ tagId: 'vat' })
  const r = rng(12)
  for (let i = 0; i < count; i++) {
    const roll = r()
    const paymentDate = addDays(today, -Math.floor(r() * 395))
    const account = accounts[Math.floor(r() * accounts.length)][0]
    const amountMinor = 1_000 + Math.floor(r() * 499_000)
    const body: Record<string, unknown> =
      roll < 0.05 && account !== 'eur'
        ? { type: 'transfer', accountId: account, toAccountId: account === 'main' ? 'cash' : 'main', amountMinor, paymentDate }
        : roll < 0.3
          ? { type: 'income', accountId: account, amountMinor, paymentDate, categoryId: income[Math.floor(r() * income.length)] }
          : { type: 'expense', accountId: account, amountMinor, paymentDate, categoryId: expense[Math.floor(r() * expense.length)], ...(r() < 0.05 ? { tags: ['vat'] } : {}) }
    await createTransaction(deps, ORG, UID, parseTransactionInput(body))
    if ((i + 1) % 500 === 0) console.log(`seeded ${i + 1} of ${count}`)
  }
}

interface Sample {
  docs: number
  aggregates: number
  bytes: number
}

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')
const sampleOf = (stats: ReportReadStats, value: unknown): Sample => ({ docs: stats.operations + stats.rollups, aggregates: stats.aggregates, bytes: bytesOf(value) })

/** Runs a workflow twice and prints what it cost; a refusal of the read limit is a result too (with its time). */
async function measure(label: string, run: () => Promise<Sample>): Promise<void> {
  for (const phase of ['cold', 'warm'] as const) {
    const cpu = process.cpuUsage()
    const started = performance.now()
    let s: Sample | null = null
    try {
      s = await run()
    } catch (e) {
      if (!(e instanceof ReportError && e.code === 'too_many_operations')) throw e
    }
    const elapsed = performance.now() - started
    const used = process.cpuUsage(cpu)
    const peakMb = process.resourceUsage().maxRSS / 1024
    const result =
      s === null
        ? `refused: too_many_operations (cap ${REPORT_SCAN_CAP})`
        : `docs ${String(s.docs).padStart(6)}  aggregates ${String(s.aggregates).padStart(4)}  bytes ${String(s.bytes).padStart(9)}`
    console.log(
      `${label.padEnd(46)} ${phase}  ${result}  ${elapsed.toFixed(0).padStart(6)} ms  cpu ${((used.user + used.system) / 1000).toFixed(0).padStart(6)} ms  peak rss ${peakMb.toFixed(0)} MB`,
    )
  }
}

async function main(): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) fail('Emulator only: run it through firebase emulators:exec (FIRESTORE_EMULATOR_HOST is not set).', 2)
  const count = opsArg(process.argv.slice(2))
  initializeApp({ projectId: 'demo-finflow' })
  const db = getFirestore()
  const today = toDay(todayUtcDay())
  const deps: LedgerDeps = { db, resolveRate: fixedRate, now: () => new Date(), today: () => today }
  console.log(`seeding ${count} operations over 13 months into the emulator...`)
  await seed(db, deps, count, today)

  const year: ReportQuery = { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31`, filters: EMPTY_ANALYTICS_FILTERS }
  const month: ReportQuery = { from: `${monthOf(today)}-01`, to: monthBounds(monthOf(today)).last, filters: EMPTY_ANALYTICS_FILTERS }
  const tagged = (q: ReportQuery): ReportQuery => ({ ...q, filters: { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] } })

  await measure('before: the browser reads every operation', async () => {
    const snap = await transactionsCol(db, ORG).orderBy('paymentDate', 'desc').get()
    return { docs: snap.size, aggregates: 0, bytes: bytesOf(snap.docs.map((d) => d.data())) }
  })
  const cashFlows: Array<[string, ReportQuery]> = [
    ['Cash Flow, this year, no filter', year],
    ['Cash Flow, this year, tag VAT', tagged(year)],
    ['Cash Flow, this month, tag VAT', tagged(month)],
  ]
  for (const [label, q] of cashFlows) {
    await measure(`after: ${label}`, async () => {
      const { report, stats } = await readCashFlowReport(deps, ORG, q)
      return sampleOf(stats, report)
    })
  }
  const pls: Array<[string, ReportQuery]> = [
    ['P&L, this year, no filter', year],
    ['P&L, this year, tag VAT', tagged(year)],
  ]
  for (const [label, q] of pls) {
    await measure(`after: ${label}`, async () => {
      const { report, stats } = await readPLReport(deps, ORG, q)
      return sampleOf(stats, report)
    })
  }
  await measure('after: balances 30 days ago', async () => {
    const { report, stats } = await readBalances(deps, ORG, addDays(today, -30))
    return sampleOf(stats, report)
  })
  await measure('after: dashboard', async () => {
    const { report, stats } = await readDashboard(deps, ORG)
    return sampleOf(stats, report)
  })
  console.log('agent tokens: not applicable (S12 has no agent-facing interface).')
  console.log('not measured: production Firestore latency, NBP latency, the bytes on the wire after compression, the browser render time.')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
