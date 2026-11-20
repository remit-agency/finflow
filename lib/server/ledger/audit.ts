import { Timestamp } from 'firebase-admin/firestore'
import type { LedgerDeps } from './deps'

export type AuditAction =
  | 'tx.create' | 'tx.update' | 'tx.delete'
  | 'account.create' | 'account.update' | 'account.delete'
  | 'counterparty.create' | 'counterparty.update'
  | 'rule.create' | 'rule.update' | 'rule.delete' | 'rule.order'
  | 'tag.create' | 'tag.update'
  | 'recurring.create' | 'recurring.update' | 'recurring.delete'
  | 'org.update' | 'ledger.rebuild' | 'migration.v2'
  /**
   * One entry per batch transaction of a Finmap import (S14b): `before: null`, `after: { importId, created }`, `via:
   * 'import'`. The undo of such an import writes `tx.delete` entries under this action with `via: 'import-undo'`.
   */
  | 'import.batch'

/**
 * What made a change when it was not a plain edit of the operation: the rules (S10), a tag's flag (S10t), making or
 * splitting a transfer (S10b: the operation changed type, went into the transfer, or came back out of it), or planned
 * payments (S11: a series created, rewrote or deleted its plans, a match linked a bank operation to a plan, a skip), or
 * the undo of a statement import (S14: `import-undo` on each operation it deletes), or a batch write of a Finmap import
 * (S14b: `import` on the `import.batch` entry of each batch).
 */
export interface AuditMeta {
  via?: 'rule' | 'tag' | 'transfer' | 'plan' | 'import' | 'import-undo'
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
