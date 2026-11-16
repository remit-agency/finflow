import { doc, getDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { parseCashMinimum } from '@/lib/domain/forecast/query'
import type { Organization } from '@/types'

// firestore.rules deny `get` both for orgs the user is not a member of and for
// org ids that do not exist (resource == null), so permission-denied means
// "no such org for this user", exactly like a missing document.
// The code is checked structurally: `instanceof FirestoreError` is not reliable
// when the SDK is loaded more than once (e.g. under Vitest).
function isPermissionDenied(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'permission-denied'
}

async function getOrganizationSnapshot(orgId: string) {
  try {
    return await getDoc(doc(db, 'organizations', orgId))
  } catch (e) {
    if (isPermissionDenied(e)) return null
    throw e
  }
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const orgDoc = await getOrganizationSnapshot(orgId)

  if (!orgDoc || !orgDoc.exists()) return null

  const data = orgDoc.data()
  return {
    id: orgDoc.id,
    name: data.name,
    currency: data.currency,
    cashMinimumMinor: parseCashMinimum(data.cashMinimumMinor),
    ownerId: data.ownerId,
    plan: data.plan,
    trialEndsAt: (data.trialEndsAt as Timestamp).toDate(),
    createdAt: (data.createdAt as Timestamp).toDate(),
  }
}
