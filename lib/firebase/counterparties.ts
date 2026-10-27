import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { parseCounterparty } from '@/lib/domain/counterparties/doc'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { db } from './firebase'

/** Counterparties are written by the server only (lib/api/counterparty-client.ts); the browser reads them here. */
export function getCounterparties(orgId: string, callback: (counterparties: Counterparty[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'organizations', orgId, 'counterparties'),
    (snap) => {
      const list: Counterparty[] = []
      let skipped = 0
      for (const d of snap.docs) {
        const c = parseCounterparty(d.id, d.data())
        if (c) list.push(c)
        else skipped++
      }
      if (skipped > 0) console.warn(`counterparties: skipped ${skipped} unreadable document(s) in ${orgId}`)
      callback(list)
    },
    (error) => {
      console.warn(`counterparties: cannot read ${orgId} (${error.code})`)
      callback([])
    },
  )
}
