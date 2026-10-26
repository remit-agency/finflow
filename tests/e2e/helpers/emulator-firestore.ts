import type { APIRequestContext } from '@playwright/test'

const PROJECT = 'demo-finflow'

export type Plain = string | number | boolean | null | Date | Plain[] | { [key: string]: Plain }
export type SeedFields = { [key: string]: Plain | undefined }

export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } }

function firestoreHost(): string {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set (run inside firebase emulators:exec)')
  return host
}

function toValue(value: Plain): FirestoreValue {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: value.length > 0 ? { values: value.map(toValue) } : {} }
  return { mapValue: { fields: toFields(value) } }
}

function toFields(data: SeedFields): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) fields[key] = toValue(value)
  }
  return fields
}

/**
 * Creates a document on the Firestore emulator as admin (`Bearer owner` bypasses the security
 * rules). Test data only; `Date` becomes a Firestore Timestamp, numbers become doubles.
 */
export async function seedDoc(
  request: APIRequestContext,
  collectionPath: string,
  docId: string,
  data: SeedFields,
): Promise<void> {
  const url = `http://${firestoreHost()}/v1/projects/${PROJECT}/databases/(default)/documents/${collectionPath}?documentId=${encodeURIComponent(docId)}`
  const res = await request.post(url, {
    headers: { Authorization: 'Bearer owner' },
    data: { fields: toFields(data) },
  })
  if (!res.ok()) throw new Error(`seed ${collectionPath}/${docId} failed: ${res.status()} ${await res.text()}`)
}

/** Reads a document as admin. Returns its raw Firestore `fields`, or null when it does not exist. */
export async function readDoc(
  request: APIRequestContext,
  path: string,
): Promise<Record<string, FirestoreValue> | null> {
  const url = `http://${firestoreHost()}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`
  const res = await request.get(url, { headers: { Authorization: 'Bearer owner' } })
  if (res.status() === 404) return null
  if (!res.ok()) throw new Error(`read ${path} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as { fields?: Record<string, FirestoreValue> }).fields ?? {}
}

/** Creates organizations/{orgId}/members/{uid} as admin (the server's job in the real app). */
export async function seedMember(
  request: APIRequestContext,
  orgId: string,
  uid: string,
  role: 'owner' | 'accountant' | 'viewer',
  addedBy = uid,
): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/members`, uid, { uid, role, createdAt: new Date(), addedBy })
}

/**
 * Writes a document through the Firestore REST API as a signed-in user (their ID token), so the
 * security rules apply. Returns the HTTP status: 200 allowed, 403 denied by the rules.
 */
export async function createDocAs(
  request: APIRequestContext,
  idToken: string,
  collectionPath: string,
  docId: string,
  data: SeedFields,
): Promise<number> {
  const url = `http://${firestoreHost()}/v1/projects/${PROJECT}/databases/(default)/documents/${collectionPath}?documentId=${encodeURIComponent(docId)}`
  const res = await request.post(url, {
    headers: { Authorization: `Bearer ${idToken}` },
    data: { fields: toFields(data) },
  })
  return res.status()
}

/** Lists the documents of a collection as admin: each entry is the document id plus its raw `fields`. */
export async function listDocs(
  request: APIRequestContext,
  collectionPath: string,
): Promise<{ id: string; fields: Record<string, FirestoreValue> }[]> {
  const url = `http://${firestoreHost()}/v1/projects/${PROJECT}/databases/(default)/documents/${collectionPath}?pageSize=300`
  const res = await request.get(url, { headers: { Authorization: 'Bearer owner' } })
  if (!res.ok()) throw new Error(`list ${collectionPath} failed: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as { documents?: { name: string; fields?: Record<string, FirestoreValue> }[] }
  return (body.documents ?? []).map((d) => ({ id: d.name.split('/').pop() ?? '', fields: d.fields ?? {} }))
}
