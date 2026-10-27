// One-off migration (S05): ledger schema 1 -> schema 2 for every company (or one with --org).
//
//   npm run migrate:ledger                          dry run: counters and drift per company, writes nothing
//   npm run migrate:ledger -- --apply               migrates accounts and operations (idempotent, resumable), then rebuilds
//   npm run migrate:ledger -- --drop-legacy         removes the schema 1 fields, only on a company whose ledger verifies ok
//   --reset-opening=<accountId,...>                 those accounts open at 0 and their balance becomes the sum of operations
//   --org=<orgId>                                   limit the run to one company
//
// Production guards (a run WITHOUT FIRESTORE_EMULATOR_HOST targets production; the emulator is never restricted),
// the same as scripts/migrate-memberships.mjs:
//   dry run         needs no flag.
//   --apply         needs --project=finflow-e94b5, otherwise it refuses with exit code 2.
//   --drop-legacy   needs --project=finflow-e94b5 AND --rules-deployed (your statement that the S05 app is deployed and the
//                   new firestore.rules are live: the old app reads the removed fields); otherwise exit code 2.
//   The flag check runs before credentials are read or anything is contacted.
//
// Credentials (never printed): GOOGLE_APPLICATION_CREDENTIALS, else the service-account JSON in .secrets/
// (finflow-*-firebase-adminsdk-*.json). Nothing from document contents is printed, only counters and ids.
// Before an apply writes to a company, the raw documents it changes are saved to .secrets/ledger-v2-backup-<time>-<orgId>.json;
// if that write fails the company is not touched.
//
// Emulator: when FIRESTORE_EMULATOR_HOST is set (for example inside `firebase emulators:exec`), the script targets project
// `demo-finflow` on that emulator and uses no credentials, so it can never reach production.
//
// The dry run (also the first pass of --apply) builds the rollups the migrated ledger will have; a company where that fails is
// reported (operation ids only) and not applied. The dry run never writes, not even the FX cache (`fxTables`).
//
// Exit code: 0 success, 1 a company failed (the others still ran; failed ids are listed), 2 bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { toDay } from '@/lib/domain/ledger/days'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { createResolver } from '@/lib/server/fx/resolver'
import { firestoreFxStore, type FxStore } from '@/lib/server/fx/store'
import { fetchNbpTables } from '@/lib/server/fx/nbp'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { todayUtcDay } from '@/lib/utils/today'
import { assertProductionFlags } from './lib/migration-guard.mjs'
import { parseLedgerCliArgs } from './lib/migrate-ledger-args'
import { dropLegacy, migrateOrg, type MigrateReport } from './lib/migrate-ledger-v2'
import { readOnlyFxStore } from './lib/readonly-fx-store'

const PROJECT_ID = 'finflow-e94b5'
const EMULATOR_PROJECT_ID = 'demo-finflow'
const SKIPPED_LINES = 20

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

/** The error text for the log: a ledger code or a message, never document contents. */
function reason(e: unknown): string {
  if (e instanceof LedgerError) return e.code
  return e instanceof Error ? e.message : 'error'
}

function printReport(r: MigrateReport): void {
  const c = r.counters
  console.log(
    `org ${r.orgId}: accounts=${r.accountsToMigrate} operations=${r.txsToMigrate} skipped=${r.skipped.length} ` +
      `currencyMismatch=${c.currencyMismatch} transferAmountAssumed=${c.transferAmountAssumed} futureActual=${c.futureActual} ` +
      `invalidReference=${c.invalidReference} trimmed=${c.trimmed} drift=${r.drift.length}`,
  )
  for (const d of r.drift) console.log(`  account ${d.accountId}: legacy=${d.legacyBalanceMinor} sum=${d.sumMinor} opening=${d.openingMinor}`)
  for (const s of r.skipped.slice(0, SKIPPED_LINES)) console.log(`  skipped ${s.kind} ${s.id}: ${s.reason}`)
  if (r.skipped.length > SKIPPED_LINES) console.log(`  ... and ${r.skipped.length - SKIPPED_LINES} more skipped`)
}

async function main(): Promise<number> {
  const parsed = parseLedgerCliArgs(process.argv.slice(2))
  if (!parsed.ok) fail(parsed.message, 2)
  const { apply, dropLegacy: drop, resetOpening, org, raw } = parsed.args

  // Before credentials are read or anything is contacted.
  const flagCheck = assertProductionFlags({
    emulator: !!process.env.FIRESTORE_EMULATOR_HOST,
    apply,
    drop,
    args: raw,
    dropFlag: '--drop-legacy',
    rulesStatement: 'the S05 app is deployed and the new firestore rules are live (the old app reads the fields this removes)',
  })
  if (!flagCheck.ok) fail(flagCheck.message, flagCheck.exitCode)

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // The Admin SDK routes every Firestore call to the emulator when this variable is set; no credentials are needed
    // and none are read, so a mistaken run cannot touch production.
    initializeApp({ projectId: EMULATOR_PROJECT_ID })
    console.log(`target: Firestore EMULATOR (project ${EMULATOR_PROJECT_ID})`)
  } else {
    initializeApp({ credential: credential(), projectId: PROJECT_ID })
    console.log(`target: PRODUCTION (project ${PROJECT_ID})`)
  }
  const db = getFirestore()

  const today = () => toDay(todayUtcDay())
  const fxStore = firestoreFxStore(db)
  const makeDeps = (store: FxStore): LedgerDeps => ({
    db,
    resolveRate: createResolver({ store, fetchTables: (a, b) => fetchNbpTables(a, b), now: () => Date.now(), today }),
    now: () => new Date(),
    today,
  })
  // The resolver caches NBP tables in `fxTables/{month}`. The dry run must not write there, so it reads through a store whose
  // writes are dropped; only the apply pass (and dropLegacy, which resolves no rates) gets the real one.
  const dryDeps = makeDeps(readOnlyFxStore(fxStore))
  const deps = makeDeps(fxStore)

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const runStamp = new Date().toISOString().replace(/:/g, '-')
  const failed: string[] = []
  for (const orgId of orgIds) {
    try {
      if (drop) {
        const dry = await dropLegacy(deps, orgId, { apply: false })
        if (dry.skipped) {
          console.log(`org ${orgId}: REFUSED, the ledger does not verify (${dry.skipped}); nothing removed`)
          failed.push(orgId)
          continue
        }
        const done = await dropLegacy(deps, orgId, { apply: true })
        if (done.skipped) throw new Error(done.skipped)
        console.log(`org ${orgId}: removed legacy fields from accounts=${done.accounts} operations=${done.transactions}`)
        continue
      }

      const dryReport = await migrateOrg(dryDeps, orgId, { apply: false, resetOpening })
      printReport(dryReport)
      if (dryReport.simulationError !== undefined) {
        console.error(`org ${orgId}: REFUSED, the rollups of the migrated ledger cannot be built (${dryReport.simulationError}); nothing applied`)
        failed.push(orgId)
        continue
      }
      if (!apply) continue

      const result = await migrateOrg(deps, orgId, {
        apply: true,
        resetOpening,
        beforeWrite: (report) => {
          if (report.accountsToMigrate === 0 && report.txsToMigrate === 0) return
          const dir = path.resolve('.secrets')
          fs.mkdirSync(dir, { recursive: true })
          const file = path.join(dir, `ledger-v2-backup-${runStamp}-${orgId}.json`)
          fs.writeFileSync(file, JSON.stringify({ orgId, savedAt: new Date().toISOString(), ...report.backup }, null, 2), { flag: 'wx' })
          console.log(`org ${orgId}: backup saved to .secrets/${path.basename(file)}`)
        },
      })
      console.log(
        `org ${orgId}: applied accounts=${result.accountsToMigrate} operations=${result.txsToMigrate} rebuildBalanceFixes=${result.rebuildBalanceFixes}` +
          (result.rebuildTruncated ? '+' : ''),
      )
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${reason(e)})`)
      failed.push(orgId)
    }
  }

  if (failed.length > 0) {
    console.error(`failed companies (${failed.length}): ${failed.join(', ')}`)
    return 1
  }
  if (!apply && !drop) console.log('DRY RUN: nothing written. Re-run with --apply to migrate.')
  return 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${reason(e)})`)
    process.exit(1)
  },
)
