import 'server-only'
import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { EXPORT_PAGE_BYTES, EXPORT_PAGE_DOCS, type ExportCollection } from '@/lib/domain/export/collections'
import { parseConnection } from '@/lib/server/banking/types'

export interface ExportDoc { id: string; data: Record<string, unknown> }
export interface ExportPage { docs: ExportDoc[]; next: string | null }

/** Firestore Timestamps become ISO strings; everything else is copied as stored (money stays integer minor units). */
export function serializeValue(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(serializeValue)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, serializeValue(x)]))
  return v
}

function shape(collection: ExportCollection, id: string, raw: Record<string, unknown>): ExportDoc | null {
  if (collection === 'bankConnections') {
    // parseConnection is the allow-list: only the fields of BankConnection survive, so a stored token never leaves.
    const c = parseConnection({ ...raw, sessionId: raw.sessionId ?? id })
    return c ? { id, data: { ...c } } : null // an unreadable connection document is skipped, never exported raw (it may hold secrets)
  }
  return { id, data: serializeValue(raw) as Record<string, unknown> }
}

/**
 * One page of a collection of company `orgId`, ordered by document id, after the id `after` (null = from the start).
 * A page holds at most EXPORT_PAGE_DOCS documents and about EXPORT_PAGE_BYTES of JSON (counted in bytes), but always at
 * least one document, so a paging client always advances. `next` is the id of the last document the page CONSUMED
 * (also when that one was skipped as unreadable), or null when the collection is finished.
 */
export async function readExportPage(db: Firestore, orgId: string, collection: ExportCollection, after: string | null): Promise<ExportPage> {
  const orgRef = db.doc(`organizations/${orgId}`)
  if (collection === 'organization') {
    const snap = await orgRef.get()
    return { docs: snap.exists ? [{ id: snap.id, data: serializeValue(snap.data()) as Record<string, unknown> }] : [], next: null }
  }
  let q = orgRef.collection(collection).orderBy(FieldPath.documentId()).limit(EXPORT_PAGE_DOCS + 1)
  if (after !== null) q = q.startAfter(after)
  const snap = await q.get()
  const docs: ExportDoc[] = []
  let bytes = 0
  let consumed = 0
  for (const d of snap.docs.slice(0, EXPORT_PAGE_DOCS)) {
    const shaped = shape(collection, d.id, d.data())
    const size = shaped ? Buffer.byteLength(JSON.stringify(shaped)) + 1 : 0 // +1: the comma between documents
    if (docs.length > 0 && bytes + size > EXPORT_PAGE_BYTES) break
    consumed++
    if (shaped) { docs.push(shaped); bytes += size }
  }
  const more = consumed < snap.docs.length
  return { docs, next: more ? snap.docs[consumed - 1].id : null }
}
