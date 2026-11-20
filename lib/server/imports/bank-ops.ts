import 'server-only'
import type { Firestore } from 'firebase-admin/firestore'
import type { BankOpView } from '@/lib/domain/import/plan'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { bankSeenCol } from '@/lib/server/banking/paths'
import { transactionsCol } from '@/lib/server/ledger/paths'

/** Keys read per `getAll` call (the marks of a whole statement can be read in several calls). */
const SEEN_CHUNK = 300

/** The keys among `keys` that are already marked in `bankSeen`: this line was imported once. */
export async function seenKeysOf(db: Firestore, orgId: string, keys: readonly string[]): Promise<Set<string>> {
  const col = bankSeenCol(db, orgId)
  const seen = new Set<string>()
  for (let i = 0; i < keys.length; i += SEEN_CHUNK) {
    const snaps = await db.getAll(...keys.slice(i, i + SEEN_CHUNK).map((key) => col.doc(key)))
    for (const s of snaps) if (s.exists) seen.add(s.id)
  }
  return seen
}

/**
 * The bank operations of the account dated from..to (inclusive, YYYY-MM-DD), grouped by day: what `takeBankMatch`
 * compares a file line with. Only actual income and expense operations that a bank sync wrote (`bank.accountRef`).
 */
export async function bankOpsOf(db: Firestore, orgId: string, accountId: string, from: string, to: string): Promise<Map<string, BankOpView[]>> {
  const byDay = new Map<string, BankOpView[]>()
  const snap = await transactionsCol(db, orgId).where('accountId', '==', accountId).where('paymentDate', '>=', from).where('paymentDate', '<=', to).get()
  for (const doc of snap.docs) {
    const tx = parseTransaction(doc.id, doc.data())
    if (!tx || tx.status !== 'actual' || tx.bank?.accountRef === undefined) continue
    if (tx.type !== 'income' && tx.type !== 'expense') continue
    const view: BankOpView = { type: tx.type, amountMinor: tx.amountMinor, ...(tx.bank.entryReference === undefined ? {} : { entryReference: tx.bank.entryReference }) }
    byDay.set(tx.paymentDate, [...(byDay.get(tx.paymentDate) ?? []), view])
  }
  return byDay
}
