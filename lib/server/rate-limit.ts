import { Timestamp, type Firestore } from 'firebase-admin/firestore'

export interface RateWindow {
  /** Short, id-safe label of the window (`m`, `h`). */
  name: string
  seconds: number
  max: number
}

/**
 * Counts one call against every window of `key` in one transaction. Returns `false`, counting nothing, when any
 * window is already full. The counter documents are `rateLimits/{key}_{name}_{bucket}`; `expiresAt` lets a Firestore
 * TTL policy remove old ones.
 */
export async function consumeRateLimit(db: Firestore, key: string, windows: readonly RateWindow[], now: Date): Promise<boolean> {
  const nowSec = Math.floor(now.getTime() / 1000)
  const slots = windows.map((w) => {
    const bucket = Math.floor(nowSec / w.seconds)
    return { w, ref: db.collection('rateLimits').doc(`${key}_${w.name}_${bucket}`), expiresAtSec: (bucket + 2) * w.seconds }
  })

  return db.runTransaction(async (t) => {
    const snaps = await Promise.all(slots.map((s) => t.get(s.ref)))
    const counts = snaps.map((snap) => (snap.get('count') as number | undefined) ?? 0)
    if (slots.some((s, i) => counts[i] >= s.w.max)) return false
    slots.forEach((s, i) => t.set(s.ref, { count: counts[i] + 1, expiresAt: Timestamp.fromMillis(s.expiresAtSec * 1000) }))
    return true
  })
}
