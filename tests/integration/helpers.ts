import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { addDays } from '@/lib/domain/ledger/days'
import { accountToDoc } from '@/lib/domain/ledger/doc'
import { flatten } from '@/lib/domain/ledger/rollups'
import { counterpartyToDoc } from '@/lib/domain/counterparties/doc'
import { tagToDoc } from '@/lib/domain/tags/doc'
import { tagNameKey } from '@/lib/domain/tags/keys'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import type { RateSnapshot } from '@/lib/server/fx/types'

export const PROJECT = 'demo-finflow'
export const TODAY = '2026-10-27'
export const UID = 'user-alice'
export const ORG = 'org1'

export function testDb(): Firestore {
  const app = getApps().find((a) => a.name === 'ledger-it') ?? initializeApp({ projectId: PROJECT }, 'ledger-it')
  return getFirestore(app)
}

export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set (run through npm run test:integration)')
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`could not clear the emulator: ${res.status}`)
}

const MID: Record<string, number> = { PLN: 1, EUR: 4.4, USD: 3.9, UAH: 0.1 }

/** A deterministic stand-in for resolveRate: cross rates through PLN, rateDate = the day before. */
export function fakeResolveRate(calls?: string[]): LedgerDeps['resolveRate'] {
  return async (from, to, date): Promise<RateSnapshot> => {
    calls?.push(`${from}>${to}@${date}`)
    const rate = from === to ? 1 : Math.round((MID[from] / MID[to]) * 1e8) / 1e8
    return {
      rate, from, to, requestedDate: date, rateDate: from === to ? date : addDays(date, -1),
      tableNo: from === to ? null : `T/${date}`, source: from === to ? 'identity' : 'NBP_A', final: date <= TODAY,
    }
  }
}

export function makeDeps(db: Firestore, over: Partial<LedgerDeps> = {}): LedgerDeps {
  return { db, resolveRate: fakeResolveRate(), now: () => new Date('2026-10-27T10:00:00Z'), today: () => TODAY, ...over }
}

export async function seedOrg(db: Firestore, orgId = ORG, currency = 'PLN'): Promise<void> {
  await db.doc(`organizations/${orgId}`).set({ name: 'Acme', currency, ownerId: UID, plan: 'trial' })
}

export async function seedCategory(db: Firestore, orgId: string, id: string, type: 'income' | 'expense'): Promise<void> {
  await db.doc(`organizations/${orgId}/categories/${id}`).set({ orgId, name: id, type, color: '#000000' })
}

export async function seedAccount(db: Firestore, orgId: string, id: string, currency: string, openingMinor = 0): Promise<void> {
  const doc = accountToDoc({ id, name: id, type: 'bank', currency, color: '#00c896', openingMinor, balanceMinor: openingMinor })
  await db.doc(`organizations/${orgId}/accounts/${id}`).set({ ...doc, orgId })
}

export async function seedCounterparty(db: Firestore, orgId: string, id: string, options: { archived?: boolean } = {}): Promise<void> {
  const doc = counterpartyToDoc({ id, name: id, ibans: [], archived: options.archived === true })
  await db.doc(`organizations/${orgId}/counterparties/${id}`).set({ ...doc, orgId })
}

/** A tag in the shape the server stores (lib/domain/tags/doc.ts) with its name key; `name` defaults to the id. */
export async function seedTag(
  db: Firestore,
  orgId: string,
  id: string,
  options: { name?: string; excludeFromAnalytics?: boolean; archived?: boolean } = {},
): Promise<void> {
  const name = options.name ?? id
  const doc = tagToDoc({ id, name, color: 'slate', excludeFromAnalytics: options.excludeFromAnalytics === true, archived: options.archived === true, recalcPending: false })
  await db.doc(`organizations/${orgId}/tags/${id}`).set({ ...doc, orgId })
  await db.doc(`organizations/${orgId}/tagKeys/${tagNameKey(name)}`).set({ tagId: id })
}

export async function readDoc(db: Firestore, path: string): Promise<Record<string, unknown> | undefined> {
  return (await db.doc(path).get()).data()
}

/** The non-zero fields of a rollup document as flat dotted fields ({} when the document is absent or all zero). */
export async function rollup(db: Firestore, orgId: string, id: string): Promise<Record<string, number>> {
  const flat = flatten((await readDoc(db, `organizations/${orgId}/rollups/${id}`)) ?? {})
  return Object.fromEntries(Object.entries(flat).filter(([, v]) => v !== 0))
}

export async function balanceOf(db: Firestore, orgId: string, accountId: string): Promise<number> {
  return (await readDoc(db, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as number
}

export async function auditActions(db: Firestore, orgId: string): Promise<string[]> {
  const snap = await db.collection(`organizations/${orgId}/audit`).get()
  return snap.docs.map((d) => d.get('action') as string).sort()
}
