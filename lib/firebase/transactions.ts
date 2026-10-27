import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type CollectionReference,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { toDay } from '@/lib/domain/ledger/days'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import type { Transaction } from '@/types'
import { db } from './firebase'
import { toUiTransaction } from './ledger-map'

export interface TransactionFilters {
  accountId?: string
  categoryId?: string
  dateFrom?: Date
  dateTo?: Date
  amountMin?: number
  amountMax?: number
  search?: string
}

function txsRef(orgId: string): CollectionReference {
  return collection(db, 'organizations', orgId, 'transactions')
}

/**
 * Operations are written by the server only (lib/api/ledger-client.ts calls it); the browser reads
 * them here. Documents that are not schema 2 are skipped and counted in the console. Planned
 * operations are not listed: nothing in the UI creates them yet, and the forecast (S13) reads them itself.
 */
function toTransactions(orgId: string, docs: QueryDocumentSnapshot[]): Transaction[] {
  const out: Transaction[] = []
  let skipped = 0
  for (const d of docs) {
    const tx = parseTransaction(d.id, d.data())
    if (!tx) skipped++
    else if (tx.status === 'actual') out.push(toUiTransaction(orgId, tx))
  }
  if (skipped > 0) console.warn(`transactions: skipped ${skipped} unreadable document(s) in ${orgId}`)
  return out
}

export function getTransactions(
  orgId: string,
  filters: TransactionFilters,
  callback: (txs: Transaction[]) => void,
): Unsubscribe {
  let q: Query = query(txsRef(orgId), orderBy('paymentDate', 'desc'))

  if (filters.accountId) q = query(q, where('accountId', '==', filters.accountId))
  if (filters.categoryId) q = query(q, where('categoryId', '==', filters.categoryId))
  if (filters.dateFrom) q = query(q, where('paymentDate', '>=', toDay(filters.dateFrom)))
  if (filters.dateTo) q = query(q, where('paymentDate', '<=', toDay(filters.dateTo)))

  return onSnapshot(q, (snap) => {
    let txs = toTransactions(orgId, snap.docs)

    // Client-side filters (amount, search)
    if (filters.amountMin !== undefined) txs = txs.filter((tx) => tx.amount >= filters.amountMin!)
    if (filters.amountMax !== undefined) txs = txs.filter((tx) => tx.amount <= filters.amountMax!)
    if (filters.search) {
      const s = filters.search.toLowerCase()
      txs = txs.filter(
        (tx) => tx.description?.toLowerCase().includes(s) || tx.counterpartyId?.toLowerCase().includes(s),
      )
    }

    callback(txs)
  })
}
