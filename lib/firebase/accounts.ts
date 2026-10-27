import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { parseAccount } from '@/lib/domain/ledger/doc'
import type { Account } from '@/types'
import { db } from './firebase'
import { toUiAccount } from './ledger-map'

/** Accounts are written by the server only (lib/api/ledger-client.ts); the browser reads them here. */
export function getAccounts(orgId: string, callback: (accounts: Account[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'organizations', orgId, 'accounts'), (snap) => {
    const accounts: Account[] = []
    let skipped = 0
    for (const d of snap.docs) {
      const account = parseAccount(d.id, d.data())
      if (account) accounts.push(toUiAccount(orgId, account))
      else skipped++
    }
    if (skipped > 0) console.warn(`accounts: skipped ${skipped} unreadable document(s) in ${orgId}`)
    callback(accounts)
  })
}
