import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { planId } from '@/lib/domain/recurring/plan'
import { ORG, UID, readDoc } from './helpers'

/** A planned occurrence of the series `ser1` on the PLN account `mil`. */
export function planOf(occurrence: string, over: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id: planId('ser1', occurrence), type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 120_000, currency: 'PLN',
    paymentDate: occurrence, accrual: { mode: 'date', date: occurrence }, isRecurring: false, tags: [], fileUrls: [],
    seriesId: 'ser1', occurrence, ...over,
  }
}

/**
 * A planned operation stored as the ledger stores it (`storedDoc` in lib/server/ledger/write.ts). A plan moves no balance
 * and no rollup, so its document is the whole of its ledger effect.
 */
export async function seedPlan(db: Firestore, plan: LedgerTransaction): Promise<void> {
  const ts = Timestamp.fromDate(new Date('2026-10-20T10:00:00Z'))
  await db.doc(`organizations/${ORG}/transactions/${plan.id}`).set({ ...transactionToDoc(plan), orgId: ORG, createdAt: ts, createdBy: UID, updatedAt: ts, updatedBy: UID })
}

export const txDoc = (db: Firestore, id: string, orgId = ORG) => readDoc(db, `organizations/${orgId}/transactions/${id}`)
export const markDoc = (db: Firestore, id: string, orgId = ORG) => readDoc(db, `organizations/${orgId}/recurringDone/${id}`)
