import { Timestamp, type Transaction } from 'firebase-admin/firestore'
import { accountToDoc, parseAccount } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { AccountInput, AccountPatch } from '@/lib/domain/ledger/entity-input'
import type { LedgerAccount } from '@/lib/domain/ledger/types'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, orgRef, transactionsCol } from './paths'

/** True when any operation (any status) uses the account as source or target. */
async function hasOperations(t: Transaction, deps: LedgerDeps, orgId: string, accountId: string): Promise<boolean> {
  const col = transactionsCol(deps.db, orgId)
  const asSource = await t.get(col.where('accountId', '==', accountId).limit(1))
  const asTarget = await t.get(col.where('toAccountId', '==', accountId).limit(1))
  return !asSource.empty || !asTarget.empty
}

/** True when a bank account (any status, also a disconnected one) is linked to the FinFlow account. S09 writes `bankAccounts`. */
async function isLinkedToBank(t: Transaction, deps: LedgerDeps, orgId: string, accountId: string): Promise<boolean> {
  const linked = await t.get(orgRef(deps.db, orgId).collection('bankAccounts').where('accountId', '==', accountId).limit(1))
  return !linked.empty
}

export async function createAccount(deps: LedgerDeps, orgId: string, uid: string, input: AccountInput): Promise<LedgerAccount> {
  const ref = accountsCol(deps.db, orgId).doc()
  const account: LedgerAccount = { id: ref.id, ...input, balanceMinor: input.openingMinor }
  await deps.db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    if (!(await t.get(orgRef(deps.db, orgId))).exists) throw new LedgerError('not_found', 'org')
    const ts = Timestamp.fromDate(deps.now())
    t.create(ref, { ...accountToDoc(account), orgId, createdAt: ts, updatedAt: ts })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'account.create', uid, ref.id, null, accountToDoc(account)))
  })
  return account
}

export async function updateAccount(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  accountId: string,
  patch: AccountPatch,
): Promise<LedgerAccount> {
  const ref = accountsCol(deps.db, orgId).doc(accountId)
  return deps.db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const before = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!before) throw new LedgerError('not_found')

    if (patch.currency !== undefined && patch.currency !== before.currency && (await hasOperations(t, deps, orgId, accountId))) {
      throw new LedgerError('account_has_operations', 'currency')
    }

    const after: LedgerAccount = { ...before, ...patch }
    // balance = opening + sum of effects: moving the opening balance moves the balance by the same amount.
    after.balanceMinor = before.balanceMinor + (after.openingMinor - before.openingMinor)

    t.update(ref, { ...accountToDoc(after), updatedAt: Timestamp.fromDate(deps.now()) })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'account.update', uid, accountId, accountToDoc(before), accountToDoc(after)))
    return after
  })
}

export async function deleteAccount(deps: LedgerDeps, orgId: string, uid: string, accountId: string): Promise<void> {
  const ref = accountsCol(deps.db, orgId).doc(accountId)
  await deps.db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const before = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!before) throw new LedgerError('not_found')
    if (await isLinkedToBank(t, deps, orgId, accountId)) throw new LedgerError('account_linked_to_bank')
    if (await hasOperations(t, deps, orgId, accountId)) throw new LedgerError('account_has_operations')
    t.delete(ref)
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'account.delete', uid, accountId, accountToDoc(before), null))
  })
}
