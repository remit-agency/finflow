import { Timestamp } from 'firebase-admin/firestore'
import type { LedgerDeps } from './deps'

export type AuditAction =
  | 'tx.create' | 'tx.update' | 'tx.delete'
  | 'account.create' | 'account.update' | 'account.delete'
  | 'counterparty.create' | 'counterparty.update'
  | 'rule.create' | 'rule.update' | 'rule.delete' | 'rule.order'
  | 'org.update' | 'ledger.rebuild' | 'migration.v2'

/** What made a change when it was not a person's own edit (S10: the rules). */
export interface AuditMeta {
  via?: 'rule'
}

/** The audit entry to `create()` in the same transaction as the change it records. */
export function auditData(
  deps: Pick<LedgerDeps, 'now'>,
  action: AuditAction,
  uid: string,
  targetId: string,
  before: unknown,
  after: unknown,
  meta: AuditMeta = {},
): Record<string, unknown> {
  return {
    at: Timestamp.fromDate(deps.now()),
    uid,
    action,
    targetId,
    before: before ?? null,
    after: after ?? null,
    ...(meta.via === undefined ? {} : { via: meta.via }),
  }
}
