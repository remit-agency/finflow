// lib/server/ledger/reader.ts
// The reads of one request through one interface (S12): plainly (the journal) or inside one read-only transaction, so every
// read sees the same snapshot and a write landing in the middle cannot make a report disagree with itself.
import type {
  AggregateQuery,
  AggregateQuerySnapshot,
  AggregateSpec,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction,
} from 'firebase-admin/firestore'

export interface Reader {
  query(q: Query): Promise<QuerySnapshot>
  aggregate<T extends AggregateSpec>(q: AggregateQuery<T>): Promise<AggregateQuerySnapshot<T>>
  getAll(refs: readonly DocumentReference[]): Promise<DocumentSnapshot[]>
}

export function directReader(db: Firestore): Reader {
  return {
    query: (q) => q.get(),
    aggregate: (q) => q.get(),
    getAll: (refs) => (refs.length === 0 ? Promise.resolve([]) : db.getAll(...refs)),
  }
}

export function transactionReader(t: Transaction): Reader {
  return {
    query: (q) => t.get(q),
    aggregate: (q) => t.get(q),
    getAll: (refs) => (refs.length === 0 ? Promise.resolve([]) : t.getAll(...refs)),
  }
}

/** Runs every read of `fn` in one read-only transaction: one consistent snapshot, no locks, nothing can be written. */
export function readSnapshot<T>(db: Firestore, fn: (reader: Reader) => Promise<T>): Promise<T> {
  return db.runTransaction((t) => fn(transactionReader(t)), { readOnly: true })
}
