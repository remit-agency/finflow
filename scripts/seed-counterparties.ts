// Adds the system counterparties (ZUS, Urząd Skarbowy) to companies that do not have them (S06).
//   npm run seed:counterparties                                         dry run over every company
//   npm run seed:counterparties -- --apply --project=finflow-e94b5      writes (production needs the project flag)
//   --org=<id> limits the run to one company.
// Idempotent: records are found by their fixed ids; archived ones are not brought back. The flag check runs
// before credentials are read or anything is contacted. With FIRESTORE_EMULATOR_HOST set it uses the emulator.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { seedExistingOrg } from '@/lib/server/counterparties/seed'
import { assertProductionFlags } from './lib/migration-guard.mjs'
import { parseSeedArgs } from './lib/seed-counterparties-args'

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

async function main(): Promise<number> {
  const parsed = parseSeedArgs(process.argv.slice(2))
  if (!parsed.ok) fail(parsed.message, 2)
  const { apply, org, raw } = parsed.args

  const flagCheck = assertProductionFlags({ emulator: !!process.env.FIRESTORE_EMULATOR_HOST, apply, drop: false, args: raw })
  if (!flagCheck.ok) fail(flagCheck.message, flagCheck.exitCode)

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: EMULATOR_PROJECT_ID })
    console.log(`target: Firestore EMULATOR (project ${EMULATOR_PROJECT_ID})`)
  } else {
    initializeApp({ credential: credential(), projectId: PROJECT_ID })
    console.log(`target: PRODUCTION (project ${PROJECT_ID})`)
  }
  const db = getFirestore()

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const failed: string[] = []
  let created = 0
  for (const orgId of orgIds) {
    try {
      const result = await seedExistingOrg(db, orgId, new Date(), { apply })
      created += result.created.length
      const taken = result.skipped.filter((s) => s.reason === 'name_taken').map((s) => s.id)
      if (result.created.length > 0 || taken.length > 0) {
        console.log(`org ${orgId}: ${apply ? 'created' : 'would create'} [${result.created.join(', ')}]${taken.length > 0 ? ` name taken: [${taken.join(', ')}]` : ''}`)
      }
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${e instanceof Error ? e.message : 'error'})`)
      failed.push(orgId)
    }
  }
  console.log(`${apply ? 'created' : 'would create'} ${created} record(s) in ${orgIds.length - failed.length} company(ies)`)
  if (failed.length > 0) {
    console.error(`failed companies (${failed.length}): ${failed.join(', ')}`)
    return 1
  }
  if (!apply) console.log('DRY RUN: nothing written. Re-run with --apply to seed.')
  return 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${e instanceof Error ? e.message : 'error'})`)
    process.exit(1)
  },
)
