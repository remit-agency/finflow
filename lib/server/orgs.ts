import 'server-only'
import { Timestamp } from 'firebase-admin/firestore'
import { getAdmin } from '@/lib/server/firebase-admin'
import { HttpError } from '@/lib/server/http-error'
import { seedSystemCounterparties } from '@/lib/server/counterparties/seed'

export const MAX_OWNED_ORGS = 3
export const TRIAL_DAYS = 14
export const ORG_CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH'] as const
export type OrgCurrency = (typeof ORG_CURRENCIES)[number]

const NAME_MAX = 120
const ALLOWED_KEYS = new Set(['name', 'currency'])
const DAY_MS = 24 * 60 * 60 * 1000

export interface CreateOrgInput {
  name: string
  currency: OrgCurrency
}

/** Validates the request body of POST /api/orgs. Throws HttpError(400) with a short code. */
export function parseCreateOrgInput(body: unknown): CreateOrgInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body')
  }
  const record = body as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) throw new HttpError(400, 'invalid_body')
  }

  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name.length < 1 || name.length > NAME_MAX) throw new HttpError(400, 'invalid_name')

  const currency = record.currency
  if (typeof currency !== 'string' || !(ORG_CURRENCIES as readonly string[]).includes(currency)) {
    throw new HttpError(400, 'invalid_currency')
  }
  return { name, currency: currency as OrgCurrency }
}

/**
 * Creates an organization and its owner membership in one Admin transaction after checking the
 * per-user limit. Returns the new organization id. The count and the writes are in the same
 * transaction, so two parallel requests cannot both slip past the limit.
 */
export async function createOrganizationForUser(uid: string, input: CreateOrgInput, now: Date = new Date()): Promise<string> {
  if (typeof uid !== 'string' || uid.length === 0 || uid.includes('/')) throw new HttpError(403, 'forbidden')

  const { db } = getAdmin()
  const orgRef = db.collection('organizations').doc()
  const memberRef = orgRef.collection('members').doc(uid)
  const createdAt = Timestamp.fromDate(now)
  const trialEndsAt = Timestamp.fromDate(new Date(now.getTime() + TRIAL_DAYS * DAY_MS))

  await db.runTransaction(async (tx) => {
    const memberships = await tx.get(db.collectionGroup('members').where('uid', '==', uid))
    const owned = memberships.docs.filter((d) => d.get('role') === 'owner').length
    if (owned >= MAX_OWNED_ORGS) throw new HttpError(409, 'org_limit_reached')

    tx.create(orgRef, {
      name: input.name,
      currency: input.currency,
      ownerId: uid,
      plan: 'trial',
      trialEndsAt,
      createdAt,
    })
    tx.create(memberRef, { uid, role: 'owner', createdAt, addedBy: uid })
    seedSystemCounterparties(tx, db, orgRef.id, now)
  })

  return orgRef.id
}
