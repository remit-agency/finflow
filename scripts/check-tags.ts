// Read-only guard for the S10t rollout: before `tags` become ids of the «Теги» list, no operation may still carry free
// text there (an edit of such an operation would be refused once the ledger checks tag ids). Never writes anything.
//   npm run check:tags                                      over the emulator when FIRESTORE_EMULATOR_HOST is set
//   npm run check:tags -- --project=finflow-e94b5           production (the flag is required; nothing is read without it)
//   --org=<id> limits the run to one company.
// Prints counts and operation ids only, never the text of a tag.
// Exit code: 0 all clear, 1 an operation carries something that is not a tag id or a read failed, 2 refused or bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { tagsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { assertReadinessTarget, parseCheckJournalArgs } from './lib/check-journal-args'
import { freeTextTagged } from './lib/check-tags'

const PROJECT_ID = 'finflow-e94b5'
const EMULATOR_PROJECT_ID = 'demo-finflow'
/** Operation ids printed per company; the count is always complete. */
const SHOW_IDS = 10

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

async function checkOrg(db: Firestore, orgId: string): Promise<{ operations: number; offending: string[] }> {
  const tagIds = new Set((await tagsCol(db, orgId).select().get()).docs.map((d) => d.id))
  const snap = await transactionsCol(db, orgId).select('tags').get()
  const offending = freeTextTagged(snap.docs.map((d) => ({ id: d.id, tags: d.get('tags') as unknown })), tagIds)
  return { operations: snap.size, offending }
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

  const notReady: string[] = []
  const errored: string[] = []
  let operations = 0
  for (const orgId of orgIds) {
    try {
      const r = await checkOrg(db, orgId)
      operations += r.operations
      if (r.offending.length > 0) {
        notReady.push(orgId)
        const shown = r.offending.slice(0, SHOW_IDS).join(', ')
        console.log(`org ${orgId}: NOT READY, ${r.offending.length} of ${r.operations} operation(s) carry tags that are not tag ids (${shown}${r.offending.length > SHOW_IDS ? ', …' : ''})`)
      } else if (r.operations > 0) {
        console.log(`org ${orgId}: ok (${r.operations} operation(s))`)
      }
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${describeError(e)})`)
      errored.push(orgId)
    }
  }
  console.log(`checked ${orgIds.length - errored.length} company(ies), ${operations} operation(s); not ready: ${notReady.length}; errors: ${errored.length}`)
  if (notReady.length > 0) console.error(`NOT READY (${notReady.length}): ${notReady.join(', ')}`)
  if (errored.length > 0) console.error(`failed companies (${errored.length}): ${errored.join(', ')}`)
  if (notReady.length === 0 && errored.length === 0) console.log('READY: no operation carries free-text tags. Nothing was written.')
  return notReady.length > 0 || errored.length > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
