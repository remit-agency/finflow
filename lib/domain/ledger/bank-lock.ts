import { receivedOn } from './effects'
import { LedgerError } from './errors'
import type { LedgerTransaction } from './types'

/** The fields that must keep matching the statement of the operation's own bank (an import, or the outgoing side of a transfer). */
const LOCKED = ['type', 'status', 'accountId', 'amountMinor', 'paymentDate'] as const
/** The incoming bank side of a transfer (S10b): what the statement of the receiving bank fixes, besides its day. */
const LOCKED_TO = ['type', 'status', 'toAccountId', 'toAmountMinor'] as const

/**
 * An operation imported from a bank may change everything except what the statement fixes. A transfer with bank sides
 * (S10b) keeps its type and the fields of each bank side: `bank` locks the account, amount and payment day the money left
 * from, `bankTo` the target account, the amount that arrived and the arrival day (`toDate ?? paymentDate`). The other
 * account of a transfer with one bank side, its tags and its comment stay editable. `next` must already carry the prior
 * bank blocks and arrival day (`withBankSides`).
 */
export function assertBankUnlocked(prior: LedgerTransaction, next: LedgerTransaction): void {
  // Every imported operation has a statement of its own bank; only a transfer whose bank side is the incoming one has not.
  if (prior.bank !== undefined || prior.bankTo === undefined) {
    for (const field of LOCKED) {
      if (prior[field] !== next[field]) throw new LedgerError('bank_locked', field)
    }
  }
  if (prior.bankTo !== undefined) {
    for (const field of LOCKED_TO) {
      if (prior[field] !== next[field]) throw new LedgerError('bank_locked', field)
    }
    if (receivedOn(prior) !== receivedOn(next)) throw new LedgerError('bank_locked', prior.toDate !== undefined ? 'toDate' : 'paymentDate')
  }
}

/** `next` with where `prior` came from (S09, S10b): its bank blocks and its arrival day. An edit never changes them. */
export function withBankSides(next: LedgerTransaction, prior: LedgerTransaction): LedgerTransaction {
  const out: LedgerTransaction = { ...next }
  if (prior.bank !== undefined) out.bank = prior.bank
  if (prior.bankTo !== undefined) out.bankTo = prior.bankTo
  if (prior.toDate !== undefined) out.toDate = prior.toDate
  return out
}
