import { bankDifference, fittedOpening } from '@/lib/domain/banking/fit'
import { parseAccount } from '@/lib/domain/ledger/doc'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { updateAccount } from '@/lib/server/ledger/accounts'
import { accountsCol } from '@/lib/server/ledger/paths'
import type { ImportDeps } from '../deps'
import { ImportError } from '../errors'
import { importsCol } from '../paths'
import { parseImportDoc } from '../types'

export interface FinmapFinishResult {
  /** The accounts whose opening was fitted by this call. */
  fitted: Array<{ accountId: string; openingMinor: number }>
  /** Every target still known: FinFlow balance minus the typed balance (0 when they agree). */
  differences: Array<{ accountId: string; differenceMinor: number }>
}

/**
 * Fits the opening balance of each account the import has a target for (S14b step 5), once. An account already `done`
 * is not fitted again. A fitted opening that would fall outside the ledger range is not written: the account stays
 * unfitted and its difference is reported. A target whose account is gone is left out of both lists.
 *
 * Only an applied Finmap import of this company can be finished (`not_found` otherwise). Writing the opening goes through
 * `updateAccount`, which takes its own transaction; two finishes racing on one account both compute the same opening from
 * the same operations, so the second write changes nothing (the ledger recomputes the balance from the opening it reads).
 */
export async function finmapFinish(deps: ImportDeps, orgId: string, uid: string, importId: string): Promise<FinmapFinishResult> {
  const ref = importsCol(deps.db, orgId).doc(importId)
  const doc = parseImportDoc((await ref.get()).data())
  if (doc === null || doc.kind !== 'finmap' || doc.status !== 'applied') throw new ImportError('not_found')

  const fitted: FinmapFinishResult['fitted'] = []
  const differences: FinmapFinishResult['differences'] = []
  for (const [accountId, target] of Object.entries(doc.fitTargets)) {
    const snap = await accountsCol(deps.db, orgId).doc(accountId).get()
    const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (account === null) continue

    let balanceMinor = account.balanceMinor
    if (doc.fit[accountId] !== 'done') {
      const openingMinor = fittedOpening(target, account.balanceMinor, account.openingMinor)
      if (Math.abs(openingMinor) <= MAX_MINOR) {
        const after = await updateAccount(deps.ledger, orgId, uid, accountId, { openingMinor })
        await ref.update({ [`fit.${accountId}`]: 'done' })
        fitted.push({ accountId, openingMinor })
        balanceMinor = after.balanceMinor
      }
    }
    differences.push({ accountId, differenceMinor: bankDifference(target, balanceMinor) })
  }
  return { fitted, differences }
}
