// Read-only check for the S10b rollout (own transfers). Per company it reads what the journal's suggestions would offer
// (pairs, ambiguous sides, bank operations of the last 90 days) and how many transfers already carry a bank side, and it
// runs once every query shape S10b adds (the day and arrival reads of the journal, the `bankTo.key` lookup of an undo), so a
// missing index shows up as FAILED_PRECONDITION with its creation link. Never writes anything.
//   npm run check:transfers                                   over the emulator when FIRESTORE_EMULATOR_HOST is set
//   npm run check:transfers -- --project=finflow-e94b5        production (the flag is required; nothing is read without it)
//   --org=<id> limits the run to one company.
// Prints counts only, never names, amounts or texts.
// Exit code: 0 everything read, 1 a read failed, 2 refused or bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { toDay } from '@/lib/domain/ledger/days'
import { dayOpsQuery } from '@/lib/server/journal/read'
import { arrivalsQuery } from '@/lib/server/ledger/balance-at'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { accountsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { readTransferSuggestions } from '@/lib/server/transfers/read'
import { todayUtcDay } from '@/lib/utils/today'
import { assertReadinessTarget, parseCheckJournalArgs } from './lib/check-journal-args'
import { sumChecks, transferCheckLine, type TransferCheck } from './lib/check-transfers'

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

async function checkOrg(db: Firestore, orgId: string): Promise<TransferCheck> {
  const deps: Pick<LedgerDeps, 'db' | 'today'> = { db, today: () => toDay(todayUtcDay()) }
  const read = await readTransferSuggestions(deps, orgId)
  // The query shapes S10b adds, each once (an empty answer is fine; a missing index throws FAILED_PRECONDITION).
  const firstAccount = (await accountsCol(db, orgId).select().limit(1).get()).docs[0]?.id
  if (firstAccount !== undefined) {
    await dayOpsQuery(deps, orgId, firstAccount, deps.today()).limit(1).get()
    await arrivalsQuery(deps, orgId, firstAccount, deps.today()).limit(1).get()
  }
  await transactionsCol(db, orgId).where('bankTo.key', '==', '_probe').limit(1).get()
  const transfers = await transactionsCol(db, orgId).where('type', '==', 'transfer').select('bank', 'bankTo').get()
  const bankTransfers = transfers.docs.filter((d) => d.get('bank') !== undefined || d.get('bankTo') !== undefined).length
  return { scanned: read.scanned, bankSides: read.bankSides, pairs: read.total, ambiguous: read.ambiguous, truncated: read.truncated, bankTransfers }
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

  const checks: TransferCheck[] = []
  const errored: string[] = []
  for (const orgId of orgIds) {
    try {
      const c = await checkOrg(db, orgId)
      checks.push(c)
      console.log(transferCheckLine(orgId, c))
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${describeError(e)})`)
      errored.push(orgId)
    }
  }
  console.log(transferCheckLine('ALL', sumChecks(checks)))
  if (errored.length > 0) console.error(`failed companies (${errored.length}): ${errored.join(', ')}`)
  else console.log('DONE: every company was read. Nothing was written.')
  return errored.length > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
