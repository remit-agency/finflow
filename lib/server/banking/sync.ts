import 'server-only'
import { randomUUID } from 'node:crypto'
import type { DocumentReference } from 'firebase-admin/firestore'
import { bankDifference, fittedOpening } from '@/lib/domain/banking/fit'
import { mapBankTransaction, pickBalance } from '@/lib/domain/banking/map'
import { addDays } from '@/lib/domain/ledger/days'
import { parseAccount } from '@/lib/domain/ledger/doc'
import { LedgerError, type LedgerErrorCode } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { updateAccount } from '@/lib/server/ledger/accounts'
import { accountsCol } from '@/lib/server/ledger/paths'
import { createTransaction, type WriteResult } from '@/lib/server/ledger/write'
import { todayDay } from '@/lib/utils/today'
import type { BankDeps } from './deps'
import type { EbTxPage } from './eb-api'
import { BankError } from './errors'
import { bankTxKeys } from './key'
import { bankAccountsCol, bankConnectionsCol, bankSeenCol } from './paths'
import { parseBankAccount, parseConnection, type BankAccount, type BankCursor } from './types'

/** New operations written per step; the browser calls again for the rest. */
export const MAX_NEW_PER_STEP = 25
/** A step that died leaves its lock; after this long another one may take over. */
export const LOCK_MS = 60_000
/** Each run asks the bank again for this many days before the last finished run (banks book late). */
export const OVERLAP_DAYS = 3

export interface SyncResult {
  imported: number
  skipped: number
  failed: number
  done: boolean
  /** Set when a run finished and the bank gave a balance. */
  bankBalanceMinor: number | null
  /** FinFlow balance minus bank balance; null while unknown. */
  differenceMinor: number | null
}

/**
 * Ledger refusals that retrying cannot fix, for a bank import (no category, no counterparty, no transfer): the operation
 * is marked seen with the reason and left out. The ledger throws `invalid_input` here for a value outside its limits
 * (an amount too large, a date before 2000). Every other LedgerError aborts the step (see `syncStep`).
 */
const PERMANENT: ReadonlySet<LedgerErrorCode> = new Set(['invalid_input'])

async function acquire(deps: BankDeps, ref: DocumentReference, token: string): Promise<BankAccount> {
  return deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const acc = snap.exists ? parseBankAccount(snap.data()) : null
    if (!acc || acc.status !== 'active') throw new BankError('not_found')
    const nowMs = deps.now().getTime()
    if (acc.syncLock !== null && acc.syncLock.until > nowMs) throw new BankError('already_running')
    t.update(ref, { syncLock: { until: nowMs + LOCK_MS, token } })
    return acc
  })
}

async function release(deps: BankDeps, ref: DocumentReference, token: string): Promise<void> {
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const lock = snap.exists ? parseBankAccount(snap.data())?.syncLock : null
    if (lock && lock.token === token) t.update(ref, { syncLock: null })
  })
}

async function markExpired(deps: BankDeps, orgId: string, connectionId: string): Promise<void> {
  await bankConnectionsCol(deps.db, orgId).doc(connectionId).set({ status: 'expired' }, { merge: true })
}

async function assertConsent(deps: BankDeps, orgId: string, acc: BankAccount): Promise<void> {
  const snap = await bankConnectionsCol(deps.db, orgId).doc(acc.connectionId).get()
  const conn = snap.exists ? parseConnection(snap.data()) : null
  if (!conn) throw new BankError('not_found')
  if (conn.status === 'expired' || todayDay(new Date(conn.validUntil)) < deps.today()) {
    await markExpired(deps, orgId, acc.connectionId)
    throw new BankError('consent_expired')
  }
}

/**
 * The FinFlow account must still exist and have the bank account's currency; checked before the bank is asked, so a
 * deleted or re-currencied account stops the sync with nothing consumed.
 */
async function assertAccount(deps: BankDeps, orgId: string, acc: BankAccount): Promise<void> {
  const snap = await accountsCol(deps.db, orgId).doc(acc.accountId).get()
  const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
  if (!account) throw new BankError('not_found')
  if (account.currency !== acc.currency) throw new BankError('currency_mismatch')
}

function startDay(acc: BankAccount): string {
  if (acc.syncedThrough === null) return acc.importFrom
  const from = addDays(acc.syncedThrough, -OVERLAP_DAYS)
  return from > acc.importFrom ? from : acc.importFrom
}

/**
 * One step of a sync: one bank page, at most MAX_NEW_PER_STEP new operations. `done: false` means "call again".
 * Safe to repeat and to interrupt: every operation has a deterministic id and a `bankSeen` mark, so a step that
 * died halfway only costs the next one a few skipped reads. The operation is written before its mark; a crash
 * between the two is healed by the replay of `createTransaction` (same id) on the next run.
 */
export async function syncStep(deps: BankDeps, orgId: string, uid: string, bankAccountId: string): Promise<SyncResult> {
  const ref = bankAccountsCol(deps.db, orgId).doc(bankAccountId)
  const token = randomUUID()
  const acc = await acquire(deps, ref, token)
  try {
    await assertConsent(deps, orgId, acc)
    await assertAccount(deps, orgId, acc)

    // A cursor is resumed only within the Warsaw day it was made on; a later run starts over (the marks make that safe).
    const today = deps.today()
    const cursor: BankCursor = acc.cursor !== null && acc.cursor.startedOn === today
      ? acc.cursor
      : { from: startDay(acc), continuationKey: null, startedOn: today }
    let page: EbTxPage
    try {
      page = await deps.eb.getTransactions(acc.ebAccountUid, { dateFrom: cursor.from, continuationKey: cursor.continuationKey })
    } catch (e) {
      if (e instanceof BankError && e.code === 'consent_expired') await markExpired(deps, orgId, acc.connectionId)
      throw e
    }

    const entries = bankTxKeys(bankAccountId, page.transactions)
    const seenCol = bankSeenCol(deps.db, orgId)
    const seenSnaps = entries.length === 0 ? [] : await deps.db.getAll(...entries.map((e) => seenCol.doc(e.key)))
    const seen = new Set(seenSnaps.filter((s) => s.exists).map((s) => s.id))

    let imported = 0
    let skipped = 0
    let failed = 0
    let stoppedEarly = false
    for (const { key, tx } of entries) {
      if (seen.has(key)) {
        skipped++
        continue
      }
      if (imported >= MAX_NEW_PER_STEP) {
        stoppedEarly = true
        break
      }
      const clientId = `bk_${key}`
      const mapped = mapBankTransaction(tx, { bankAccountId, accountId: acc.accountId, accountCurrency: acc.currency, clientId })
      if (!mapped.ok) {
        // A pending operation is not an operation yet: no mark, it will arrive booked.
        if (mapped.reason === 'status') {
          skipped++
          continue
        }
        await seenCol.doc(key).set({ txId: clientId, at: deps.now().toISOString(), reason: mapped.reason })
        failed++
        continue
      }
      let written: WriteResult
      try {
        written = await createTransaction(deps.ledger, orgId, uid, parseTransactionInput(mapped.input), mapped.bank)
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e
        // Not an operation yet: no mark, it arrives on a later sync once the date is today or before.
        if (e.code === 'future_actual') {
          skipped++
          continue
        }
        // Anything else that may pass later (ledger_busy, conflict, account_not_found, ...) aborts the step: the cursor
        // stays where it was, the lock is released, and the next call repeats this page without losing it.
        if (!PERMANENT.has(e.code)) throw e
        await seenCol.doc(key).set({ txId: clientId, at: deps.now().toISOString(), reason: e.code })
        failed++
        continue
      }
      // The mark is written after the operation. A crash in between is healed by the replay of this create (same id).
      await seenCol.doc(key).set({
        txId: clientId,
        at: deps.now().toISOString(),
        bank: mapped.bank,
        snapshot: {
          type: mapped.input.type,
          accountId: mapped.input.accountId,
          amountMinor: mapped.input.amountMinor,
          paymentDate: mapped.input.paymentDate,
        },
      })
      // A replayed create is an operation that already exists (the heal above): nothing new arrived.
      if (written.replayed) skipped++
      else imported++
    }

    const progress = { imported, skipped, failed, bankBalanceMinor: null, differenceMinor: null }
    if (stoppedEarly) {
      await ref.update({ cursor })
      return { ...progress, done: false }
    }
    if (page.continuationKey !== null) {
      await ref.update({ cursor: { ...cursor, continuationKey: page.continuationKey } })
      return { ...progress, done: false }
    }
    return { ...progress, ...(await finish(deps, orgId, uid, ref, acc, cursor)), done: true }
  } finally {
    await release(deps, ref, token)
  }
}

/** The last page is in: read the bank balance, fit the opening balance on the first run, close the run. */
async function finish(deps: BankDeps, orgId: string, uid: string, ref: DocumentReference, acc: BankAccount, cursor: BankCursor) {
  let bankBalance = acc.bankBalance
  try {
    const picked = pickBalance(await deps.eb.getBalances(acc.ebAccountUid), acc.currency)
    if (picked) bankBalance = { ...picked, at: deps.now().toISOString() }
  } catch (e) {
    if (e instanceof BankError && e.code === 'consent_expired') {
      await markExpired(deps, orgId, acc.connectionId)
      throw e
    }
    // Any other balance failure keeps the previous balance; the operations are in.
  }

  const update: Record<string, unknown> = { cursor: null, lastSyncAt: deps.now().toISOString(), syncedThrough: cursor.startedOn }
  if (bankBalance !== null) update.bankBalance = bankBalance
  const accountRef = accountsCol(deps.db, orgId).doc(acc.accountId)

  if (!acc.firstSyncDone && bankBalance !== null) {
    const snap = await accountRef.get()
    const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (account) {
      const opening = fittedOpening(bankBalance.amountMinor, account.balanceMinor, account.openingMinor)
      if (Math.abs(opening) <= MAX_MINOR) {
        await updateAccount(deps.ledger, orgId, uid, acc.accountId, { openingMinor: opening })
        update.firstSyncDone = true
      }
    }
  }
  await ref.update(update)

  if (bankBalance === null) return { bankBalanceMinor: null, differenceMinor: null }
  const after = await accountRef.get()
  const account = after.exists ? parseAccount(after.id, after.data()) : null
  return { bankBalanceMinor: bankBalance.amountMinor, differenceMinor: account ? bankDifference(bankBalance.amountMinor, account.balanceMinor) : null }
}
