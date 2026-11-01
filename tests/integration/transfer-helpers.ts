import type { Firestore } from 'firebase-admin/firestore'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { BankInfo, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID } from './helpers'

/** A bank key (32 hex characters, as `bankTxKeys` makes them) from a small number. */
export const KEY = (n: number): string => n.toString(16).padStart(32, '0')

export interface BankOp {
  key: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  paymentDate: string
  categoryId?: string
  description?: string
  tags?: string[]
}

/**
 * A bank operation exactly as the sync leaves it (lib/server/banking/sync.ts): the ledger writes it under `bk_<key>` with its
 * bank block (rollups and audit included), then its `bankSeen` mark with the locked fields it was imported with.
 */
export async function importBankOp(db: Firestore, deps: LedgerDeps, op: BankOp): Promise<LedgerTransaction> {
  const bank: BankInfo = { accountRef: `ba-${op.accountId}`, entryReference: `ref-${op.key.slice(-4)}`, counterpartyName: 'Własne konto', remittance: `Przelew ${op.key.slice(-4)}` }
  const body: Record<string, unknown> = {
    clientId: `bk_${op.key}`,
    type: op.type,
    accountId: op.accountId,
    amountMinor: op.amountMinor,
    paymentDate: op.paymentDate,
    tags: op.tags ?? [],
  }
  if (op.categoryId !== undefined) body.categoryId = op.categoryId
  if (op.description !== undefined) body.description = op.description
  const { transaction } = await createTransaction(deps, ORG, UID, parseTransactionInput(body, { internal: true }), bank)
  await db.doc(`organizations/${ORG}/bankSeen/${op.key}`).set({
    txId: `bk_${op.key}`,
    at: '2026-10-20T10:00:00.000Z',
    bank,
    snapshot: { type: op.type, accountId: op.accountId, amountMinor: op.amountMinor, paymentDate: op.paymentDate },
  })
  return transaction
}
