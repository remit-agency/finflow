// Read-only probe of an existing Enable Banking connection (S09 spike). Prints the SHAPE of the answers only:
// key names, counts, presence rates, balance types. Never prints names, IBANs, amounts or references.
//   npm run spike:eb -- --project=finflow-e94b5 --org=<orgId>
// Needs .secrets/enablebanking-app-id.txt, .secrets/enablebanking-private.key and the Firebase service-account JSON.
import fs from 'node:fs'
import path from 'node:path'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createJwt } from '@/lib/enablebanking/jwt'

const PROJECT_ID = 'finflow-e94b5'
const BASE = process.env.EB_API_BASE ?? 'https://api.enablebanking.com'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

/** Structure of a JSON value without its content. */
function shape(v: unknown, depth = 0): unknown {
  if (v === null) return 'null'
  if (Array.isArray(v)) return depth > 3 ? `array(${v.length})` : [`array(${v.length})`, v.length ? shape(v[0], depth + 1) : null]
  if (typeof v === 'object') {
    if (depth > 3) return 'object'
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shape(x, depth + 1)]))
  }
  if (typeof v === 'string') return `string(${v.length})`
  return typeof v
}

async function call(token: string, pathAndQuery: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` } })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { nonJson: true, length: text.length }
  }
  return { status: res.status, json }
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

async function main() {
  if (arg('project') !== PROJECT_ID) fail(`Refused: pass --project=${PROJECT_ID} (production, read-only).`)
  const orgId = arg('org')
  if (!orgId) fail('Pass --org=<orgId>.')

  const secrets = path.resolve('.secrets')
  process.env.ENABLEBANKING_APP_ID = fs.readFileSync(path.join(secrets, 'enablebanking-app-id.txt'), 'utf8').trim()
  process.env.ENABLEBANKING_PRIVATE_KEY = fs.readFileSync(path.join(secrets, 'enablebanking-private.key'), 'utf8')
  const keyFile = fs.readdirSync(secrets).find((f) => /^finflow-.*-firebase-adminsdk-.*\.json$/.test(f))
  if (!keyFile) fail('No Firebase service-account JSON in .secrets/.')
  const app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(path.join(secrets, keyFile), 'utf8'))), projectId: PROJECT_ID })
  const db = getFirestore(app)

  const connections = await db.collection(`organizations/${orgId}/bankConnections`).get()
  console.log(`connections: ${connections.size}`)
  const token = await createJwt()

  for (const doc of connections.docs) {
    const sessionId = doc.get('sessionId') as string | undefined
    console.log(`\n== connection ${doc.id.slice(0, 6)}… institution=${String(doc.get('institutionName'))} connectedAt=${String(doc.get('connectedAt'))}`)
    if (!sessionId) {
      console.log('no sessionId on the document')
      continue
    }
    const session = await call(token, `/sessions/${encodeURIComponent(sessionId)}`)
    console.log('GET /sessions/{id}', session.status)
    console.log('session shape:', JSON.stringify(shape(session.json)))
    const body = session.json as Record<string, unknown>
    const access = (body?.access ?? {}) as Record<string, unknown>
    console.log('access.valid_until:', String(access.valid_until ?? 'absent'), '| psu_type:', String(body?.psu_type ?? 'absent'), '| status:', String(body?.status ?? 'absent'))

    const accounts = ((body?.accounts_data ?? body?.accounts) as unknown[]) ?? []
    for (const [i, raw] of accounts.entries()) {
      const acc = (typeof raw === 'string' ? { uid: raw } : raw) as Record<string, unknown>
      const uid = acc.uid as string | undefined
      console.log(`\n-- account #${i + 1}: keys=${Object.keys(acc).join(',')} currency=${String(acc.currency ?? 'absent')} hasIban=${JSON.stringify(acc.account_id ?? null) !== 'null'} hasIdentificationHash=${acc.identification_hash !== undefined}`)
      if (!uid) continue

      const details = await call(token, `/accounts/${encodeURIComponent(uid)}/details`)
      console.log('GET details', details.status, 'shape:', JSON.stringify(shape(details.json)))

      const balances = await call(token, `/accounts/${encodeURIComponent(uid)}/balances`)
      const list = ((balances.json as Record<string, unknown>)?.balances as Record<string, unknown>[]) ?? []
      console.log('GET balances', balances.status, 'types:', list.map((b) => `${String(b.balance_type)}/${String((b.balance_amount as Record<string, unknown>)?.currency)}`).join(','), 'shape:', JSON.stringify(shape(list[0] ?? null)))

      const from = isoDay(-90)
      let key: string | null = null
      let pages = 0
      let total = 0
      const presence: Record<string, number> = {}
      const statuses: Record<string, number> = {}
      const indicators: Record<string, number> = {}
      const fingerprints = new Map<string, number>()
      let minDay = '9999'
      let maxDay = '0000'
      let firstError: { status: number; json: unknown } | null = null
      do {
        const q = new URLSearchParams({ date_from: from, transaction_status: 'BOOK' })
        if (key) q.set('continuation_key', key)
        const page = await call(token, `/accounts/${encodeURIComponent(uid)}/transactions?${q}`)
        if (page.status !== 200) {
          firstError = page
          break
        }
        pages++
        const data = page.json as Record<string, unknown>
        const txs = (data.transactions as Record<string, unknown>[]) ?? []
        key = (data.continuation_key as string | null | undefined) ?? null
        if (pages === 1) console.log('transaction shape:', JSON.stringify(shape(txs[0] ?? null)))
        for (const t of txs) {
          total++
          for (const [k, v] of Object.entries(t)) if (v !== null && v !== undefined && v !== '') presence[k] = (presence[k] ?? 0) + 1
          statuses[String(t.status)] = (statuses[String(t.status)] ?? 0) + 1
          indicators[String(t.credit_debit_indicator)] = (indicators[String(t.credit_debit_indicator)] ?? 0) + 1
          const day = String(t.booking_date ?? t.value_date ?? t.transaction_date ?? '')
          if (day && day < minDay) minDay = day
          if (day && day > maxDay) maxDay = day
          const fp = JSON.stringify([day, (t.transaction_amount as Record<string, unknown>)?.amount, t.credit_debit_indicator, JSON.stringify(t.creditor ?? t.debtor ?? null), JSON.stringify(t.remittance_information ?? null)])
          fingerprints.set(fp, (fingerprints.get(fp) ?? 0) + 1)
        }
      } while (key && pages < 50)
      if (firstError) console.log('transactions error', firstError.status, JSON.stringify(shape(firstError.json)))
      const dupGroups = [...fingerprints.values()].filter((n) => n > 1).length
      console.log(`transactions: total=${total} pages=${pages} range=${minDay}..${maxDay} statuses=${JSON.stringify(statuses)} indicators=${JSON.stringify(indicators)}`)
      console.log('field presence:', JSON.stringify(presence))
      console.log(`identical-fingerprint groups (same day/amount/party/text): ${dupGroups}`)
    }
  }
}

main().catch((e) => {
  console.error('spike failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
