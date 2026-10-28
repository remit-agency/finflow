import { isDay } from '@/lib/domain/ledger/days'
import { isId } from '@/lib/domain/ledger/guards'

/**
 * The listing order of the journal: payment date, then creation time (down to the nanosecond, as Firestore
 * stores it), then id; all descending. It is a total order, so a page boundary never splits ties.
 */
export interface JournalKey {
  paymentDate: string
  createdAtS: number
  createdAtN: number
  id: string
}

/** Negative when `a` is listed before `b`. */
export function compareKeys(a: JournalKey, b: JournalKey): number {
  if (a.paymentDate !== b.paymentDate) return a.paymentDate > b.paymentDate ? -1 : 1
  if (a.createdAtS !== b.createdAtS) return a.createdAtS > b.createdAtS ? -1 : 1
  if (a.createdAtN !== b.createdAtN) return a.createdAtN > b.createdAtN ? -1 : 1
  if (a.id !== b.id) return a.id > b.id ? -1 : 1
  return 0
}

/** Opaque to callers: URL-safe base64 of a JSON array. */
export function encodeCursor(k: JournalKey): string {
  const json = JSON.stringify([k.paymentDate, k.createdAtS, k.createdAtN, k.id])
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCursor(cursor: string): JournalKey | null {
  try {
    const url = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const padded = url + '='.repeat((4 - (url.length % 4)) % 4)
    const parsed: unknown = JSON.parse(atob(padded))
    if (!Array.isArray(parsed) || parsed.length !== 4) return null
    const [paymentDate, s, n, id] = parsed as unknown[]
    if (!isDay(paymentDate) || !isId(id)) return null
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) return null
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 999_999_999) return null
    return { paymentDate, createdAtS: s, createdAtN: n, id }
  } catch {
    return null
  }
}

export const DEFAULT_PAGE = 50
export const MAX_PAGE = 100

/** The page size from a query string: 50 by default, 1 to 100. */
export function parseLimit(raw: string | null): number {
  if (raw === null || !/^-?\d+$/.test(raw)) return DEFAULT_PAGE
  return Math.min(MAX_PAGE, Math.max(1, Number(raw)))
}
