import { collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { CompaniesLoadError } from './auth-errors'
import { db } from './firebase'
import { getOrganization } from './firestore'
import { isValidOrgId } from '@/lib/shell/org-id'
import { isRole, type Role } from '@/lib/shell/permissions'
import type { Organization } from '@/types'

export interface Membership {
  orgId: string
  role: Role
}

/** The role in a membership document, or null when the data is not a valid membership. */
export function roleFromMemberData(data: unknown): Role | null {
  if (typeof data !== 'object' || data === null) return null
  const role = (data as { role?: unknown }).role
  return isRole(role) ? role : null
}

/**
 * The caller's role in `orgId`, or null when there is no (valid) membership. Reading one's own
 * membership document is always allowed by the rules, so "no access" is an empty read, not an error.
 * A malformed company id (it comes from the URL) is "no membership" without touching Firestore.
 */
export async function getMembership(orgId: string, uid: string): Promise<Role | null> {
  if (!isValidOrgId(orgId)) return null
  const snap = await getDoc(doc(db, 'organizations', orgId, 'members', uid))
  return snap.exists() ? roleFromMemberData(snap.data()) : null
}

/**
 * The caller's memberships in every company. The query must filter `uid` to the caller's own
 * uid: the rules (match /{path=**}/members/{memberId}) are not a filter.
 */
export async function getMemberships(uid: string): Promise<Membership[]> {
  const snap = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)))
  const result: Membership[] = []
  for (const d of snap.docs) {
    const role = roleFromMemberData(d.data())
    const orgId = d.ref.parent.parent?.id
    if (role && orgId) result.push({ orgId, role })
  }
  return result
}

/**
 * For the login and register pages: like getMyOrganizations, but a failed read becomes a
 * CompaniesLoadError (the page shows its localized message) instead of the raw Firestore error.
 */
export async function getMyOrganizationsForAuthPage(uid: string): Promise<Organization[]> {
  try {
    return await getMyOrganizations(uid)
  } catch {
    throw new CompaniesLoadError()
  }
}

/** The companies the user belongs to, oldest first (companies that cannot be loaded are skipped). */
export async function getMyOrganizations(uid: string): Promise<Organization[]> {
  const memberships = await getMemberships(uid)
  const orgs = await Promise.all(memberships.map((m) => getOrganization(m.orgId)))
  return orgs
    .filter((o): o is Organization => o !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}
