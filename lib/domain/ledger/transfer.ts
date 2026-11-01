import type { AccountRef } from './build'
import { daysApart } from './days'
import { receivedOn } from './effects'
import { LedgerError } from './errors'
import { BANK_CLIENT_ID_PREFIX, MAX_FILE_URLS } from './input'
import { MAX_ARRIVAL_DAYS, type BankInfo, type BankToInfo, type LedgerTransaction } from './types'
import { mergeTags } from '@/lib/domain/tags/assign'

/** The bank key of a bank operation id (`bk_` + key), or null for any other id. */
export function bankKeyOf(id: string): string | null {
  return id.startsWith(BANK_CLIENT_ID_PREFIX) && id.length > BANK_CLIENT_ID_PREFIX.length ? id.slice(BANK_CLIENT_ID_PREFIX.length) : null
}

/** The side of a transfer an operation can be: the money that left (`out`) or the money that arrived (`in`). */
export type BankSide = 'out' | 'in'

/** What `bankSideOf` reads; the suggestions read (lib/domain/transfers/pairs.ts) has these fields too. */
export type BankSideSource = Pick<LedgerTransaction, 'id' | 'type' | 'status' | 'isRecurring' | 'bank'>

/**
 * The bank side an operation can give a transfer (S10b): an actual income or expense imported from a bank under its bank
 * id and not tied to a recurring template. Anything else (a manual operation, a planned one, a transfer) is null.
 */
export function bankSideOf(tx: BankSideSource): BankSide | null {
  if (tx.status !== 'actual' || tx.isRecurring || tx.bank === undefined || bankKeyOf(tx.id) === null) return null
  if (tx.type === 'expense') return 'out'
  if (tx.type === 'income') return 'in'
  return null
}

type Shared = Pick<LedgerTransaction, 'id' | 'type' | 'status' | 'paymentDate' | 'accrual' | 'isRecurring' | 'tags' | 'fileUrls' | 'description' | 'projectId'>

/**
 * What a transfer built from a bank operation keeps of it: id, payment day, tags, files, comment and project. Category,
 * counterparty, accrual, rates and the rules' trace go (a transfer has no P&L side), and so does `excluded`: the ledger
 * decides it from the tags inside its transaction.
 */
function sharedOf(tx: LedgerTransaction): Shared {
  const out: Shared = {
    id: tx.id,
    type: 'transfer',
    status: 'actual',
    paymentDate: tx.paymentDate,
    accrual: { mode: 'date', date: tx.paymentDate },
    isRecurring: false,
    tags: [...tx.tags],
    fileUrls: [...tx.fileUrls],
  }
  if (tx.description !== undefined) out.description = tx.description
  if (tx.projectId !== undefined) out.projectId = tx.projectId
  return out
}

/**
 * «Зробити переказом» (S10b): a bank expense of A becomes a transfer A → `target`, a bank income of A a transfer
 * `target` → A whose incoming side is the bank one (`bankTo`). The bank side keeps its account, amount and day, so the bank
 * account's balance does not move; the target (a cash box, a manual account) gets the other side. Throws `not_eligible`,
 * `invalid_input` on `toAccountId` (the same account) or `currency_mismatch` (a conversion moves one amount).
 */
export function convertToTransfer(tx: LedgerTransaction, target: AccountRef): LedgerTransaction {
  const side = bankSideOf(tx)
  if (side === null) throw new LedgerError('not_eligible')
  if (target.id === tx.accountId) throw new LedgerError('invalid_input', 'toAccountId')
  if (target.currency !== tx.currency) throw new LedgerError('currency_mismatch', 'toAccountId')
  const bank = tx.bank as BankInfo
  const amounts = { amountMinor: tx.amountMinor, toAmountMinor: tx.amountMinor }
  if (side === 'out') {
    return { ...sharedOf(tx), ...amounts, accountId: tx.accountId, currency: tx.currency, toAccountId: target.id, toCurrency: target.currency, bank }
  }
  return {
    ...sharedOf(tx),
    ...amounts,
    accountId: target.id,
    currency: target.currency,
    toAccountId: tx.accountId,
    toCurrency: tx.currency,
    bankTo: { key: bankKeyOf(tx.id) as string, ...bank },
  }
}

export interface MergedTransfer {
  transfer: LedgerTransaction
  /** Tags of the income that did not fit next to the expense's (at most 10 on an operation). */
  droppedTags: string[]
}

/**
 * «Об’єднати в переказ» (S10b): a bank expense of A and a bank income of B become one transfer A → B under the expense's id,
 * with the real amounts of both banks; the arrival day is the income's day when it differs. No balance moves. The tags of
 * both stay (the expense's first, at most 10). Throws `not_eligible` unless `out` is a bank expense and `inc` a bank income
 * of another account, at most MAX_ARRIVAL_DAYS apart, with equal amounts when the currency is one (a difference would be a
 * bank fee, and a transfer in one currency has one amount).
 */
export function mergeToTransfer(out: LedgerTransaction, inc: LedgerTransaction): MergedTransfer {
  if (bankSideOf(out) !== 'out' || bankSideOf(inc) !== 'in' || out.accountId === inc.accountId) throw new LedgerError('not_eligible')
  if (out.currency === inc.currency && out.amountMinor !== inc.amountMinor) throw new LedgerError('not_eligible')
  if (daysApart(out.paymentDate, inc.paymentDate) > MAX_ARRIVAL_DAYS) throw new LedgerError('not_eligible')
  const tags = mergeTags(out.tags, inc.tags)
  const transfer: LedgerTransaction = {
    ...sharedOf(out),
    tags,
    fileUrls: [...new Set([...out.fileUrls, ...inc.fileUrls])].slice(0, MAX_FILE_URLS),
    accountId: out.accountId,
    amountMinor: out.amountMinor,
    currency: out.currency,
    toAccountId: inc.accountId,
    toAmountMinor: inc.amountMinor,
    toCurrency: inc.currency,
    bank: out.bank as BankInfo,
    bankTo: { key: bankKeyOf(inc.id) as string, ...(inc.bank as BankInfo) },
  }
  if (inc.paymentDate !== out.paymentDate) transfer.toDate = inc.paymentDate
  if (transfer.description === undefined && inc.description !== undefined) transfer.description = inc.description
  if (transfer.projectId === undefined && inc.projectId !== undefined) transfer.projectId = inc.projectId
  return { transfer, droppedTags: inc.tags.filter((id) => !tags.includes(id)) }
}

export interface SplitSides {
  /** The operation under the transfer's own id: the expense (the outgoing bank side), or the income of a deposit. */
  kept: LedgerTransaction
  /** The income re-created under its own bank id when the transfer had both bank sides; null otherwise. */
  recreated: LedgerTransaction | null
}

/**
 * «Розділити» (S10b): a transfer with a bank side becomes the bank operations it was. The outgoing bank side comes back as
 * the expense under the transfer's id; the incoming one as the income under its own bank id (`bk_` + key), on the arrival
 * day, with the bank's text as its comment; a deposit (only the incoming side from a bank) comes back as that income under
 * the transfer's id. Both keep the transfer's tags and files. No category, counterparty or rates: the ledger resolves the
 * rates of a side in another currency again. No balance moves. Throws `not_eligible` for anything but an actual transfer
 * with a bank side.
 */
export function splitTransferSides(tx: LedgerTransaction): SplitSides {
  if (tx.type !== 'transfer' || tx.status !== 'actual' || (tx.bank === undefined && tx.bankTo === undefined)) throw new LedgerError('not_eligible')
  const common = { status: 'actual' as const, isRecurring: false, tags: [...tx.tags], fileUrls: [...tx.fileUrls] }
  const finish = (op: LedgerTransaction, description: string | undefined): LedgerTransaction => {
    const out: LedgerTransaction = { ...op }
    if (description !== undefined) out.description = description
    if (tx.projectId !== undefined) out.projectId = tx.projectId
    return out
  }
  const income = (id: string, bank: BankInfo): LedgerTransaction => {
    const day = receivedOn(tx)
    return {
      ...common,
      id,
      type: 'income',
      accountId: tx.toAccountId as string,
      amountMinor: tx.toAmountMinor as number,
      currency: tx.toCurrency as string,
      paymentDate: day,
      accrual: { mode: 'date', date: day },
      bank,
    }
  }

  if (tx.bank === undefined) {
    const { key, ...bank } = tx.bankTo as BankToInfo
    // A deposit is stored under the id of the income it was.
    if (bankKeyOf(tx.id) !== key) throw new LedgerError('not_eligible')
    return { kept: finish(income(tx.id, bank), tx.description), recreated: null }
  }
  const expense: LedgerTransaction = {
    ...common,
    id: tx.id,
    type: 'expense',
    accountId: tx.accountId,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    paymentDate: tx.paymentDate,
    accrual: { mode: 'date', date: tx.paymentDate },
    bank: tx.bank,
  }
  const kept = finish(expense, tx.description)
  if (tx.bankTo === undefined) return { kept, recreated: null }
  const { key, ...bank } = tx.bankTo
  const recreated: LedgerTransaction = { ...income(`${BANK_CLIENT_ID_PREFIX}${key}`, bank) }
  if (bank.remittance !== undefined) recreated.description = bank.remittance
  if (tx.projectId !== undefined) recreated.projectId = tx.projectId
  return { kept, recreated }
}
