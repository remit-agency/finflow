import { LedgerError } from '@/lib/domain/ledger/errors'
import type { OrgPatch } from '@/lib/domain/ledger/entity-input'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { auditCol, orgRef, transactionsCol } from './paths'

/**
 * Name and currency of the company. The currency defines every stored base amount, so it cannot
 * change once the company has any operation (409 currency_locked).
 */
export async function updateOrganization(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  patch: OrgPatch,
): Promise<{ name: string; currency: string }> {
  const ref = orgRef(deps.db, orgId)
  return deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new LedgerError('not_found')
    const before = { name: snap.get('name') as string, currency: snap.get('currency') as string }
    const after = { name: patch.name ?? before.name, currency: patch.currency ?? before.currency }

    if (after.currency !== before.currency) {
      const any = await t.get(transactionsCol(deps.db, orgId).limit(1))
      if (!any.empty) throw new LedgerError('currency_locked', 'currency')
    }

    t.update(ref, after)
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'org.update', uid, orgId, before, after))
    return after
  })
}
