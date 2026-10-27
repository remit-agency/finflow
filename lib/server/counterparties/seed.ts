import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { counterpartyToDoc } from '@/lib/domain/counterparties/doc'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { nameKey } from '@/lib/domain/counterparties/normalize'
import { SYSTEM_COUNTERPARTIES, systemCounterparty } from '@/lib/domain/counterparties/system'
import { auditData } from '@/lib/server/ledger/audit'
import { auditCol, counterpartiesCol, counterpartyKeysCol, orgRef } from '@/lib/server/ledger/paths'

/** For a company being created: nothing exists yet, so the records and their name keys are simply created. */
export function seedSystemCounterparties(t: Transaction, db: Firestore, orgId: string, now: Date): void {
  const ts = Timestamp.fromDate(now)
  for (const spec of SYSTEM_COUNTERPARTIES) {
    t.create(counterpartiesCol(db, orgId).doc(spec.id), { ...counterpartyToDoc(systemCounterparty(spec)), orgId, createdAt: ts, updatedAt: ts })
    t.create(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name)), { counterpartyId: spec.id })
  }
}

export interface SeedResult {
  created: string[]
  skipped: Array<{ id: string; reason: 'exists' | 'name_taken' }>
}

/**
 * Adds the system records a company does not have yet. Records are found by their fixed id (so an archived one is
 * not brought back and a rename is not mistaken for a missing record); a record whose name a user already took is
 * skipped. With `apply: false` nothing is written.
 */
export async function seedExistingOrg(db: Firestore, orgId: string, now: Date, options: { apply: boolean }): Promise<SeedResult> {
  return db.runTransaction(async (t) => {
    const org = await t.get(orgRef(db, orgId))
    const reads = await Promise.all(
      SYSTEM_COUNTERPARTIES.map(async (spec) => ({
        spec,
        doc: await t.get(counterpartiesCol(db, orgId).doc(spec.id)),
        key: await t.get(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name))),
      })),
    )
    if (!org.exists) throw new CounterpartyError('not_found')

    const result: SeedResult = { created: [], skipped: [] }
    const ts = Timestamp.fromDate(now)
    for (const { spec, doc, key } of reads) {
      if (doc.exists) result.skipped.push({ id: spec.id, reason: 'exists' })
      else if (key.exists) result.skipped.push({ id: spec.id, reason: 'name_taken' })
      else {
        result.created.push(spec.id)
        if (options.apply) {
          const c = systemCounterparty(spec)
          t.create(counterpartiesCol(db, orgId).doc(spec.id), { ...counterpartyToDoc(c), orgId, createdAt: ts, updatedAt: ts })
          t.create(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name)), { counterpartyId: spec.id })
          t.create(auditCol(db, orgId).doc(), auditData({ now: () => now }, 'counterparty.create', 'system', spec.id, null, counterpartyToDoc(c)))
        }
      }
    }
    return result
  })
}
