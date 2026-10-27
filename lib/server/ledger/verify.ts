import { flatten, diffRollups, type RollupDiff, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { computeLedger, type ExpectedLedger } from '@/lib/domain/ledger/expected'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { LedgerDeps } from './deps'
import { accountsCol, orgRef, rollupsCol, transactionsCol } from './paths'

export const REPORT_LIMIT = 50

export interface LedgerReport {
  ok: boolean
  accounts: number
  transactions: number
  /** Operations that exist but cannot be counted (not schema 2, missing account or base amounts). */
  uncountable: string[]
  /** Accounts that are not schema 2 documents. */
  unreadableAccounts: string[]
  balanceDiffs: Array<{ accountId: string; stored: number; expected: number }>
  rollupDiffs: RollupDiff[]
  /** True when a list above was cut at REPORT_LIMIT entries. */
  truncated: boolean
}

export interface LoadedLedger {
  baseCurrency: string
  accounts: LedgerAccount[]
  unreadableAccounts: string[]
  txs: LedgerTransaction[]
  unreadableTransactions: string[]
  storedRollups: RollupDocs
}

export async function loadLedger(deps: LedgerDeps, orgId: string): Promise<LoadedLedger> {
  const org = await orgRef(deps.db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')

  const accounts: LedgerAccount[] = []
  const unreadableAccounts: string[] = []
  for (const doc of (await accountsCol(deps.db, orgId).get()).docs) {
    const account = parseAccount(doc.id, doc.data())
    if (account) accounts.push(account)
    else unreadableAccounts.push(doc.id)
  }

  const txs: LedgerTransaction[] = []
  const unreadableTransactions: string[] = []
  for (const doc of (await transactionsCol(deps.db, orgId).get()).docs) {
    const tx = parseTransaction(doc.id, doc.data())
    if (tx) txs.push(tx)
    else unreadableTransactions.push(doc.id)
  }

  const storedRollups: RollupDocs = new Map()
  for (const doc of (await rollupsCol(deps.db, orgId).get()).docs) storedRollups.set(doc.id, flatten(doc.data()))

  return { baseCurrency: org.get('currency') as string, accounts, unreadableAccounts, txs, unreadableTransactions, storedRollups }
}

export function buildReport(data: LoadedLedger, expected: ExpectedLedger): LedgerReport {
  const balanceDiffs = data.accounts
    .filter((a) => a.balanceMinor !== expected.balances[a.id])
    .map((a) => ({ accountId: a.id, stored: a.balanceMinor, expected: expected.balances[a.id] }))
  const rollupDiffs = diffRollups(data.storedRollups, expected.rollups)
  const uncountable = [...data.unreadableTransactions, ...expected.invalid]
  const truncated = balanceDiffs.length > REPORT_LIMIT || rollupDiffs.length > REPORT_LIMIT || uncountable.length > REPORT_LIMIT
  return {
    ok: balanceDiffs.length === 0 && rollupDiffs.length === 0 && uncountable.length === 0 && data.unreadableAccounts.length === 0,
    accounts: data.accounts.length,
    transactions: data.txs.length + data.unreadableTransactions.length,
    uncountable: uncountable.slice(0, REPORT_LIMIT),
    unreadableAccounts: data.unreadableAccounts.slice(0, REPORT_LIMIT),
    balanceDiffs: balanceDiffs.slice(0, REPORT_LIMIT),
    rollupDiffs: rollupDiffs.slice(0, REPORT_LIMIT),
    truncated,
  }
}

/** Read-only: compares stored balances and rollups with what the operations imply. */
export async function verifyLedger(deps: LedgerDeps, orgId: string): Promise<LedgerReport> {
  const data = await loadLedger(deps, orgId)
  return buildReport(data, computeLedger(data.accounts, data.txs, data.baseCurrency))
}
