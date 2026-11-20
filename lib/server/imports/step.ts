import 'server-only'
import { randomUUID } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { bankDifference, fittedOpening } from '@/lib/domain/banking/fit'
import { clean } from '@/lib/domain/banking/map'
import { judgeOp, overlapsBank } from '@/lib/domain/import/plan'
import type { ImportStepRequest, StepStatement } from '@/lib/domain/import/request'
import type { ImportOp, RefusalReason } from '@/lib/domain/import/types'
import type { ImportStepResult } from '@/lib/domain/import/view'
import { parseAccount } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import type { BankInfo, LedgerAccount } from '@/lib/domain/ledger/types'
import type { Rule } from '@/lib/domain/rules/types'
import { bankSeenCol } from '@/lib/server/banking/paths'
import { createWithRules, readStepRules } from '@/lib/server/banking/sync'
import { updateAccount } from '@/lib/server/ledger/accounts'
import { accountsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { ImportError } from './errors'
import type { ImportDeps } from './deps'
import { bankOpsOf, seenKeysOf } from './bank-ops'
import { importKey } from './key'
import { importLocksCol, importsCol } from './paths'
import { parseImportDoc, type ImportDoc } from './types'

/** A step that died leaves its lock; after this long another step may take over (as the bank sync does). */
const LOCK_MS = 60_000

export type { ImportStepResult }

interface Totals {
  created: number
  seen: number
  bank: number
  refused: ImportStepResult['refused']
}

/**
 * One step of a statement: at most 25 lines, written as operations of the account through the S09 pipeline. Safe to repeat:
 * a line is written before its mark, a refused line is never marked, and the same line of the same file gets the same key.
 * The account's step lock is held for the whole step and released in `finally`.
 */
export async function importStep(deps: ImportDeps, orgId: string, uid: string, req: ImportStepRequest): Promise<ImportStepResult> {
  const account = await loadAccount(deps, orgId, req.accountId)
  const lockRef = importLocksCol(deps.db, orgId).doc(account.id)
  const token = randomUUID()
  await acquire(deps, lockRef, token)
  try {
    return await runStep(deps, orgId, uid, account, req)
  } finally {
    await release(deps, lockRef, token)
  }
}

/** The account of an id, or `account_not_found`. */
export async function loadAccount(deps: ImportDeps, orgId: string, accountId: string): Promise<LedgerAccount> {
  const snap = await accountsCol(deps.db, orgId).doc(accountId).get()
  const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
  if (!account) throw new ImportError('account_not_found')
  return account
}

/** Takes the step lock of an account, or `already_running` while another holder's lease runs. */
export async function acquire(deps: ImportDeps, ref: DocumentReference, token: string): Promise<void> {
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const nowMs = deps.now().getTime()
    const held = snap.data()?.until
    if (typeof held === 'number' && held > nowMs) throw new ImportError('already_running')
    t.set(ref, { until: nowMs + LOCK_MS, token })
  })
}

/** Frees the step lock when it is still this holder's. */
export async function release(deps: ImportDeps, ref: DocumentReference, token: string): Promise<void> {
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (snap.data()?.token === token) t.update(ref, { until: 0, token: null })
  })
}

async function runStep(deps: ImportDeps, orgId: string, uid: string, account: LedgerAccount, req: ImportStepRequest): Promise<ImportStepResult> {
  const { ref, importId, doc } = await openImport(deps, orgId, uid, req)
  const totals: Totals = { created: 0, seen: 0, bank: 0, refused: [] }
  try {
    await judgeFit(deps, orgId, ref, doc, account.id)
    await writeOperations(deps, orgId, uid, account, importId, req, totals)
  } finally {
    // Recorded even when the step aborts: the operations written so far are facts of the import.
    await recordTotals(ref, account.id, req.statement, totals)
  }
  const end = req.last ? await finishStatement(deps, orgId, uid, ref, account.id, req.statement) :{ fitted: false, balanceMinor: null, closingMinor: null, differenceMinor: null }
  return { importId, created: totals.created, skipped: { seen: totals.seen, bank: totals.bank }, refused: totals.refused, done: req.last, ...end }
}

/** The import the step belongs to: the one it names (applied only), else a new one. */
async function openImport(deps: ImportDeps, orgId: string, uid: string, req: ImportStepRequest): Promise<{ ref: DocumentReference; importId: string; doc: ImportDoc }> {
  if (req.importId !== undefined) {
    const ref = importsCol(deps.db, orgId).doc(req.importId)
    const doc = parseImportDoc((await ref.get()).data())
    if (doc === null || doc.status !== 'applied') throw new ImportError('not_found')
    return { ref, importId: ref.id, doc }
  }
  const ref = importsCol(deps.db, orgId).doc()
  const doc: ImportDoc = {
    schemaVersion: 1,
    fileName: req.fileName,
    accountIds: [],
    createdAt: Timestamp.fromDate(deps.now()),
    createdBy: uid,
    period: { from: req.statement.from, to: req.statement.to },
    counts: { created: 0, skipped: 0, refused: 0 },
    statements: [],
    fit: {},
    status: 'applied',
    undo: { deleted: 0, kept: 0 },
  }
  await ref.set(doc)
  return { ref, importId: ref.id, doc }
}

/** Decided once per import and account, on the first step that touches the account: empty accounts get their opening fitted. */
async function judgeFit(deps: ImportDeps, orgId: string, ref: DocumentReference, doc: ImportDoc, accountId: string): Promise<void> {
  if (doc.fit[accountId] !== undefined) return
  const empty = await accountIsEmpty(deps, orgId, accountId)
  await ref.update({ [`fit.${accountId}`]: empty ? 'pending' : 'no' })
}

async function accountIsEmpty(deps: ImportDeps, orgId: string, accountId: string): Promise<boolean> {
  const col = transactionsCol(deps.db, orgId)
  const [asSource, asTarget] = await Promise.all([col.where('accountId', '==', accountId).limit(1).get(), col.where('toAccountId', '==', accountId).limit(1).get()])
  return asSource.empty && asTarget.empty
}

async function writeOperations(deps: ImportDeps, orgId: string, uid: string, account: LedgerAccount, importId: string, req: ImportStepRequest, totals: Totals): Promise<void> {
  if (req.operations.length === 0) return
  const keys = req.operations.map((op) => importKey(account.id, op))
  const seen = await seenKeysOf(deps.db, orgId, keys)
  const days = req.operations.map((op) => op.day).sort()
  const bankOps = await bankOpsOf(deps.db, orgId, account.id, days[0], days[days.length - 1])

  // The rules are read once per step, and only when a new operation arrives (S10).
  let rules: Rule[] | null = null
  for (let i = 0; i < req.operations.length; i++) {
    const op = req.operations[i]
    const key = keys[i]
    const reason = judgeOp(op, { accountCurrency: account.currency, statementCurrency: req.statement.currency, today: deps.today() })
    if (reason !== null) {
      totals.refused.push({ day: op.day, amountMinor: op.amountMinor, reason })
      continue
    }
    if (seen.has(key)) {
      totals.seen++
      continue
    }
    if (overlapsBank(op, bankOps.get(op.day) ?? [])) {
      totals.bank++
      continue
    }
    rules ??= await readStepRules(deps, orgId)
    const outcome = await createOperation(deps, orgId, uid, account, importId, op, key, rules)
    if ('refused' in outcome) totals.refused.push({ day: op.day, amountMinor: op.amountMinor, reason: outcome.refused })
    else if (outcome.replayed) totals.seen++
    else totals.created++
  }
}

/**
 * Writes one line as an operation `bk_<key>` with its file block, then its mark. A ledger refusal that is a fact about the
 * line is returned (no mark); any other ledger error aborts the step, which repeats later with nothing lost.
 */
async function createOperation(
  deps: ImportDeps,
  orgId: string,
  uid: string,
  account: LedgerAccount,
  importId: string,
  op: ImportOp,
  key: string,
  rules: readonly Rule[],
): Promise<{ replayed: boolean } | { refused: RefusalReason }> {
  const clientId = `bk_${key}`
  const bank = fileBankInfo(importId, op)
  const body = {
    clientId,
    type: op.type,
    status: 'actual',
    accountId: account.id,
    amountMinor: op.amountMinor,
    paymentDate: op.day,
    ...(bank.remittance === undefined ? {} : { description: bank.remittance }),
  }
  let written
  try {
    written = await createWithRules(deps, orgId, uid, parseTransactionInput(body, { internal: true }), bank, account.currency, rules)
  } catch (e) {
    if (!(e instanceof LedgerError)) throw e
    if (e.code === 'future_actual') return { refused: 'future_date' }
    if (e.code === 'invalid_input') return { refused: 'amount' }
    throw e
  }
  // The mark is written after the operation. A crash in between is healed by the replay of this create (same id).
  await bankSeenCol(deps.db, orgId).doc(key).set({
    txId: clientId,
    at: deps.now().toISOString(),
    bank,
    snapshot: { type: op.type, accountId: account.id, amountMinor: op.amountMinor, paymentDate: op.day },
  })
  return { replayed: written.replayed }
}

/** The provenance block of a file operation: the import, and the text as the statement gives it (no account reference). */
function fileBankInfo(importId: string, op: ImportOp): BankInfo {
  const bank: BankInfo = { importId }
  const entryReference = clean(op.reference, 200)
  const counterpartyName = clean(op.counterpartyName, 200)
  const remittance = clean(op.remittance, 500)
  if (entryReference !== undefined) bank.entryReference = entryReference
  if (counterpartyName !== undefined) bank.counterpartyName = counterpartyName
  if (remittance !== undefined) bank.remittance = remittance
  return bank
}

async function recordTotals(ref: DocumentReference, accountId: string, statement: StepStatement, totals: Totals): Promise<void> {
  await ref.update({
    'counts.created': FieldValue.increment(totals.created),
    'counts.skipped': FieldValue.increment(totals.seen + totals.bank),
    'counts.refused': FieldValue.increment(totals.refused.length),
    accountIds: FieldValue.arrayUnion(accountId),
    statements: FieldValue.arrayUnion({ source: statement.source, accountId, from: statement.from, to: statement.to }),
  })
}

/**
 * The last step of a statement: fits the opening balance when this import found the account empty, the statement is complete
 * (the client read it with no issue and it adds up) and its currency is the account's; then reports the difference. A
 * statement that is not complete, or of another currency, never fits: its difference is still reported.
 */
async function finishStatement(
  deps: ImportDeps,
  orgId: string,
  uid: string,
  ref: DocumentReference,
  accountId: string,
  statement: StepStatement,
): Promise<{ fitted: boolean; balanceMinor: number; closingMinor: number | null; differenceMinor: number | null }> {
  const closing = statement.closingMinor
  const doc = parseImportDoc((await ref.get()).data())
  let fitted = false
  if (doc?.fit[accountId] === 'pending' && closing !== null && statement.complete) {
    // Read after the operations of this step are written: the fit is computed from the balance as it stands now.
    const account = await loadAccount(deps, orgId, accountId)
    if (statement.currency === account.currency) {
      const opening = fittedOpening(closing, account.balanceMinor, account.openingMinor)
      if (Math.abs(opening) <= MAX_MINOR) {
        await updateAccount(deps.ledger, orgId, uid, accountId, { openingMinor: opening })
        await ref.update({ [`fit.${accountId}`]: 'done' })
        fitted = true
      }
    }
  }
  const after = await loadAccount(deps, orgId, accountId)
  return { fitted, balanceMinor: after.balanceMinor, closingMinor: closing, differenceMinor: closing === null ? null : bankDifference(closing, after.balanceMinor) }
}
