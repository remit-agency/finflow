// The logic of scripts/erase-org.ts and scripts/erase-user.ts (S15a, GDPR erasure). Every dependency is injected, so the
// integration tests run it on the emulator with a fake Auth and a fake bank.
//
// Every function returns counts (and, for a refusal, company ids), never document content: the CLIs print only those.
//
// Partial failure: each step is idempotent, so a run that failed half-way is safe to run again and continues.
//   Company: the bank sessions are revoked first (a revoked or unknown session counts as success on a rerun), and if any
//     revocation fails nothing is deleted. `recursiveDelete` removes the descendants before the company document, so a
//     failure in the middle leaves the document (or at least its subcollections) and a rerun finds the company again.
//     The erasure log is written last: a failure before it means a rerun, which writes it once the deletion is complete.
//   User: the sole-owner check comes first and refuses before anything is changed. Then the memberships, the consents
//     (with their events), the scrub of `email`/`name` in audit entries, the Auth user (the CLI treats an already
//     deleted Auth user as success) and finally the log. A failure at any step leaves the later steps for the rerun.
import { createHash } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Firestore, type WriteBatch } from 'firebase-admin/firestore'
import { bankConnectionsCol } from '@/lib/server/banking/paths'
import { orgRef } from '@/lib/server/ledger/paths'
import { membershipsQuery } from '@/lib/server/orgs'

export interface EraseAuth {
  getUserByEmail(email: string): Promise<{ uid: string }>
  deleteUser(uid: string): Promise<void>
}

export interface EraseDeps {
  db: Firestore
  auth: EraseAuth
  /** Ends one Enable Banking session; a session that is already gone must resolve. */
  revokeBankSession(sessionId: string): Promise<void>
  now: () => Date
}

export type EraseErrorCode = 'sole_owner' | 'bank_revoke_failed' | 'not_found'

/**
 * A refused or impossible erasure. `detail` is the ids of the companies the user is the only owner of (`sole_owner`) or
 * the number of bank sessions that could not be revoked (`bank_revoke_failed`); never a name or an email.
 */
export class EraseError extends Error {
  constructor(
    readonly code: EraseErrorCode,
    readonly detail?: string[] | number,
  ) {
    super(`erase refused: ${code}`)
    this.name = 'EraseError'
  }
}

export interface OrgErasePlan {
  orgId: string
  /** Documents per direct subcollection of the company (nested ones are deleted too, but not counted). */
  collections: Record<string, number>
  /** The Enable Banking sessions of the company's bank connections. */
  bankSessions: string[]
  /** Bank connections without a readable session id: they cannot be revoked. */
  unreadableBankConnections: number
  members: number
}

export interface UserErasePlan {
  uid: string
  memberships: { orgId: string; role: string }[]
  /** Companies where this user is the only owner: they must be erased (or handed over) first. */
  soleOwnerOf: string[]
  /** `userConsents/{uid}` and its events. */
  consentDocs: number
  /** Audit entries written by the user that carry an `email` or a `name` field. */
  auditToScrub: number
}

/** Personal fields that an audit entry must not keep once its author is erased. Normal entries carry neither. */
const AUDIT_PERSONAL_FIELDS = ['email', 'name'] as const
const BATCH_LIMIT = 500

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertId(id: string): void {
  if (id === '' || id.includes('/')) throw new EraseError('not_found')
}

async function countCollections(ref: DocumentReference): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const cols = (await ref.listCollections()).sort((a, b) => a.id.localeCompare(b.id))
  for (const c of cols) out[c.id] = (await c.count().get()).data().count
  return out
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

/** `organizations/{org}/{col}/{doc}`: a document of a company's subcollection (collection-group hits elsewhere are ignored). */
function isOrgChild(d: DocumentSnapshot): boolean {
  return d.ref.parent.parent?.parent.id === 'organizations'
}

async function inBatches(db: Firestore, refs: readonly DocumentReference[], write: (b: WriteBatch, ref: DocumentReference) => void): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch()
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) write(batch, ref)
    await batch.commit()
  }
}

/** The LAST step of an erasure: who (hashed), when and how many documents; nothing that was erased. */
async function writeLog(deps: EraseDeps, kind: 'org' | 'user', id: string, counts: Record<string, number>): Promise<void> {
  await deps.db.collection('_meta').doc('erasures').collection('log').add({ kind, idHash: sha256(id), at: Timestamp.fromDate(deps.now()), counts })
}

export async function planOrgErase(deps: EraseDeps, orgId: string): Promise<OrgErasePlan> {
  assertId(orgId)
  const ref = orgRef(deps.db, orgId)
  const [snap, collections] = await Promise.all([ref.get(), countCollections(ref)])
  // A company document gone but subcollections left (written without it) is still something to erase.
  if (!snap.exists && Object.keys(collections).length === 0) throw new EraseError('not_found')
  const sessions = new Set<string>()
  let unreadable = 0
  for (const d of (await bankConnectionsCol(deps.db, orgId).select('sessionId').get()).docs) {
    const id: unknown = d.get('sessionId')
    if (typeof id === 'string' && id !== '') sessions.add(id)
    else unreadable++
  }
  return { orgId, collections, bankSessions: [...sessions].sort(), unreadableBankConnections: unreadable, members: collections.members ?? 0 }
}

/**
 * Revokes every bank session of the company, then deletes the company with all its subcollections (members, so the
 * membership lookup no longer finds it; ledger lock and import locks included) and logs the erasure. If any session
 * cannot be revoked (or has no readable id), nothing is deleted unless `skipBankRevoke`. The members' Auth accounts are
 * not touched. The counts are those of the plan read just before the deletion.
 */
export async function executeOrgErase(deps: EraseDeps, orgId: string, options: { skipBankRevoke: boolean }): Promise<{ counts: Record<string, number>; revoked: number }> {
  const plan = await planOrgErase(deps, orgId)
  let revoked = 0
  if (!options.skipBankRevoke) {
    if (plan.unreadableBankConnections > 0) throw new EraseError('bank_revoke_failed', plan.unreadableBankConnections)
    let failed = 0
    for (const sessionId of plan.bankSessions) {
      try {
        await deps.revokeBankSession(sessionId)
        revoked++
      } catch {
        failed++
      }
    }
    if (failed > 0) throw new EraseError('bank_revoke_failed', failed)
  }
  await deps.db.recursiveDelete(orgRef(deps.db, orgId))
  await writeLog(deps, 'org', orgId, plan.collections)
  return { counts: plan.collections, revoked }
}

async function resolveUid(deps: EraseDeps, ref: { uid?: string; email?: string }): Promise<string> {
  if (ref.uid !== undefined) {
    assertId(ref.uid)
    return ref.uid
  }
  if (ref.email === undefined || ref.email === '') throw new EraseError('not_found')
  try {
    const { uid } = await deps.auth.getUserByEmail(ref.email)
    assertId(uid)
    return uid
  } catch (e) {
    if (e instanceof EraseError) throw e
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'auth/user-not-found') throw new EraseError('not_found')
    throw e
  }
}

interface UserState {
  plan: UserErasePlan
  memberRefs: DocumentReference[]
  auditRefs: DocumentReference[]
}

async function readUser(deps: EraseDeps, ref: { uid?: string; email?: string }): Promise<UserState> {
  const { db } = deps
  const uid = await resolveUid(deps, ref)
  const memberDocs = (await membershipsQuery(db, uid).get()).docs.filter(isOrgChild)
  const memberships = memberDocs
    .map((d) => ({ orgId: d.ref.parent.parent!.id, role: typeof d.get('role') === 'string' ? (d.get('role') as string) : 'unknown' }))
    .sort((a, b) => a.orgId.localeCompare(b.orgId))

  const soleOwnerOf: string[] = []
  for (const m of memberships) {
    if (m.role !== 'owner') continue
    const owners = await orgRef(db, m.orgId).collection('members').where('role', '==', 'owner').select().get()
    if (owners.docs.every((d) => d.id === uid)) soleOwnerOf.push(m.orgId)
  }

  const consent = db.doc(`userConsents/${uid}`)
  const consentDocs = ((await consent.get()).exists ? 1 : 0) + sum(await countCollections(consent))

  // Needs the COLLECTION_GROUP index on audit.uid (firestore.indexes.json).
  const audit = await db.collectionGroup('audit').where('uid', '==', uid).select(...AUDIT_PERSONAL_FIELDS).get()
  const auditRefs = audit.docs.filter((d) => isOrgChild(d) && AUDIT_PERSONAL_FIELDS.some((f) => d.get(f) !== undefined)).map((d) => d.ref)

  return { plan: { uid, memberships, soleOwnerOf, consentDocs, auditToScrub: auditRefs.length }, memberRefs: memberDocs.map((d) => d.ref), auditRefs }
}

export async function planUserErase(deps: EraseDeps, ref: { uid?: string; email?: string }): Promise<UserErasePlan> {
  return (await readUser(deps, ref)).plan
}

/**
 * Erases a user who is not the only owner of any company: their memberships, `userConsents/{uid}` with its events, the
 * `email`/`name` fields of audit entries they wrote, their Auth account, then logs it. The audit entries themselves stay
 * (the uid there is a pseudonym and the entries are the company's history of changes).
 */
export async function executeUserErase(deps: EraseDeps, ref: { uid?: string; email?: string }): Promise<{ counts: Record<string, number> }> {
  const { db } = deps
  const { plan, memberRefs, auditRefs } = await readUser(deps, ref)
  if (plan.soleOwnerOf.length > 0) throw new EraseError('sole_owner', plan.soleOwnerOf)

  await inBatches(db, memberRefs, (b, r) => b.delete(r))
  await db.recursiveDelete(db.doc(`userConsents/${plan.uid}`))
  const scrub = Object.fromEntries(AUDIT_PERSONAL_FIELDS.map((f) => [f, FieldValue.delete()]))
  await inBatches(db, auditRefs, (b, r) => b.update(r, scrub))
  await deps.auth.deleteUser(plan.uid)

  const counts = { memberships: memberRefs.length, consentDocs: plan.consentDocs, auditScrubbed: auditRefs.length }
  await writeLog(deps, 'user', plan.uid, counts)
  return { counts }
}
