import 'server-only'
import { isDay } from '@/lib/server/fx/days'
import type { MonthDoc, NbpTable } from '@/lib/server/fx/types'

export interface FxStore {
  get(month: string): Promise<MonthDoc | null>
  set(doc: MonthDoc): Promise<void>
}

// The slice of the Admin Firestore this store needs (keeps it testable without the SDK).
type DbLike = {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): unknown }>
      set(value: object): Promise<unknown>
    }
  }
}

const COLLECTION = 'fxTables'

function isTable(raw: unknown): raw is NbpTable {
  if (typeof raw !== 'object' || raw === null) return false
  const t = raw as Record<string, unknown>
  if (typeof t.no !== 'string' || !isDay(t.effectiveDate)) return false
  if (typeof t.rates !== 'object' || t.rates === null) return false
  return Object.values(t.rates).every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
}

/** A stored document that does not look right is a cache miss, never an error. */
export function parseMonthDoc(raw: unknown, month: string): MonthDoc | null {
  if (typeof raw !== 'object' || raw === null) return null
  const d = raw as Record<string, unknown>
  if (d.month !== month || !Array.isArray(d.tables) || !d.tables.every(isTable)) return null
  if (typeof d.fetchedAt !== 'number' || !Number.isFinite(d.fetchedAt)) return null
  if (!isDay(d.fetchedDay)) return null
  if (typeof d.complete !== 'boolean') return null
  return { month, tables: d.tables, fetchedAt: d.fetchedAt, fetchedDay: d.fetchedDay, complete: d.complete }
}

export function firestoreFxStore(db: DbLike): FxStore {
  return {
    async get(month) {
      const snap = await db.collection(COLLECTION).doc(month).get()
      return snap.exists ? parseMonthDoc(snap.data(), month) : null
    },
    async set(doc) {
      await db.collection(COLLECTION).doc(doc.month).set(doc)
    },
  }
}
