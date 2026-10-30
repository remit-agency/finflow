import 'server-only'
import { FieldPath, Timestamp, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { encodeCursor, type JournalKey } from '@/lib/domain/journal/order'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { TransactionPatch } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { RuleError } from '@/lib/domain/rules/errors'
import { withCurrency, type RuleInput } from '@/lib/domain/rules/input'
import { applyRules, ruleOperationOf } from '@/lib/domain/rules/match'
import type { ApplyStepResult, CheckStepResult, PreviewResult, Rule } from '@/lib/domain/rules/types'
import { MAX_TX_TAGS } from '@/lib/domain/tags/types'
import { FxError } from '@/lib/server/fx/types'
import { keyOf } from '@/lib/server/journal/read'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { orgRef, transactionsCol } from '@/lib/server/ledger/paths'
import { updateTransaction } from '@/lib/server/ledger/write'
import { loadUsableRules } from './read'

/** Operations one check or apply step reads, in the journal order. */
export const SCAN_PER_STEP = 200
/** Operations one apply step changes at most: one Firestore transaction each, as a bulk change of the journal. */
export const APPLY_PER_STEP = 25
/** Operations «Перевірити» reads at most, in one query. */
export const PREVIEW_CAP = 2000

/** Smaller steps for tests. */
export interface StepLimits {
  scan?: number
  apply?: number
}

/** The journal order (payment date, creation time, id, all descending): the unfiltered journal index serves it. */
function journalOrder(deps: LedgerDeps, orgId: string): Query {
  return transactionsCol(deps.db, orgId).orderBy('paymentDate', 'desc').orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
}

async function readChunk(deps: LedgerDeps, orgId: string, cursor: JournalKey | null, size: number): Promise<QueryDocumentSnapshot[]> {
  const q = journalOrder(deps, orgId)
  const from = cursor === null ? q : q.startAfter(cursor.paymentDate, new Timestamp(cursor.createdAtS, cursor.createdAtN), cursor.id)
  return (await from.limit(size).get()).docs
}

/**
 * The end of a step. A step that could not place any document it read (no string payment date: a legacy document)
 * cannot move the cursor, so the scan stops there instead of reading the same documents again.
 */
function finish(docs: number, size: number, last: JournalKey | null, cursor: JournalKey | null): { done: boolean; cursor: string | null } {
  const done = docs < size || last === cursor
  return { done, cursor: done || last === null ? null : encodeCursor(last) }
}

/** One step of `check`: what the rules would fill among the next SCAN_PER_STEP operations. Writes nothing. */
export async function checkStep(deps: LedgerDeps, orgId: string, cursor: JournalKey | null, limits: StepLimits = {}): Promise<CheckStepResult> {
  const rules = await loadUsableRules(deps.db, orgId)
  const empty = { scanned: 0, matchOps: 0, categories: 0, counterparties: 0, tags: 0 }
  if (rules.length === 0) return { ...empty, done: true, cursor: null }
  const size = limits.scan ?? SCAN_PER_STEP
  const docs = await readChunk(deps, orgId, cursor, size)
  const counts = { ...empty }
  let last = cursor
  for (const d of docs) {
    counts.scanned++
    last = keyOf(d) ?? last
    const tx = parseTransaction(d.id, d.data())
    if (tx === null) continue
    const outcome = applyRules(rules, ruleOperationOf(tx))
    if (outcome.applied.length === 0) continue
    counts.matchOps++
    if (outcome.categoryId !== undefined) counts.categories++
    if (outcome.counterpartyId !== undefined) counts.counterparties++
    if (outcome.tagIds !== undefined) counts.tags++
  }
  return { ...counts, ...finish(docs.length, size, last, cursor) }
}

/**
 * One step of `apply`: fills what the rules give, at most APPLY_PER_STEP operations, each through `updateTransaction`
 * with the version this step read (`expectVersion`): a person's change after the read wins, the write is a `conflict`
 * and counts as failed. A ledger or rate refusal fails only that operation; anything else aborts the step.
 */
export async function applyStep(deps: LedgerDeps, orgId: string, uid: string, cursor: JournalKey | null, limits: StepLimits = {}): Promise<ApplyStepResult> {
  const rules = await loadUsableRules(deps.db, orgId)
  if (rules.length === 0) return { scanned: 0, changed: 0, failed: 0, done: true, cursor: null }
  const size = limits.scan ?? SCAN_PER_STEP
  const most = limits.apply ?? APPLY_PER_STEP
  const docs = await readChunk(deps, orgId, cursor, size)
  let scanned = 0
  let changed = 0
  let failed = 0
  let last = cursor
  let full = false
  for (const d of docs) {
    if (changed + failed >= most) {
      full = true
      break
    }
    scanned++
    last = keyOf(d) ?? last
    const tx = parseTransaction(d.id, d.data())
    if (tx === null) continue
    const outcome = applyRules(rules, ruleOperationOf(tx))
    if (outcome.applied.length === 0) continue
    const patch: TransactionPatch = {}
    if (outcome.categoryId !== undefined) patch.categoryId = outcome.categoryId
    if (outcome.counterpartyId !== undefined) patch.counterpartyId = outcome.counterpartyId
    if (outcome.tagIds !== undefined) patch.tags = outcome.tagIds
    try {
      await updateTransaction(deps, orgId, uid, tx.id, patch, { autoRules: outcome.applied, expectVersion: d.updateTime })
      changed++
    } catch (e) {
      if (!(e instanceof LedgerError || e instanceof FxError)) throw e
      failed++
    }
  }
  if (full) return { scanned, changed, failed, done: false, cursor: last === null ? null : encodeCursor(last) }
  return { scanned, changed, failed, ...finish(docs.length, size, last, cursor) }
}

/** An operation the draft rule could give something: an empty category or counterparty, or room for a tag of the rule it lacks (S10t). */
function couldGive(rule: Rule, tx: LedgerTransaction): boolean {
  if (tx.categoryId === undefined || tx.counterpartyId === undefined) return true
  return tx.tags.length < MAX_TX_TAGS && (rule.actions.tagIds ?? []).some((id) => !tx.tags.includes(id))
}

/**
 * «Перевірити»: reads the latest `cap` operations in one query and counts, among the ones the draft rule could give
 * something (`couldGive`), how many it would. Firestore cannot ask for a missing field, so the cap applies to the
 * operations read; `capped` says the query was full. Writes nothing; the rule's `active` is ignored.
 */
export async function previewRule(deps: LedgerDeps, orgId: string, input: RuleInput, cap = PREVIEW_CAP): Promise<PreviewResult> {
  const org = await orgRef(deps.db, orgId).get()
  if (!org.exists) throw new RuleError('not_found')
  const rule: Rule = {
    id: 'preview',
    name: input.name,
    type: input.type,
    active: true,
    order: 0,
    createdAtMs: 0,
    conditions: withCurrency(input.conditions, org.get('currency') as string),
    actions: input.actions,
  }
  const snap = await journalOrder(deps, orgId).limit(cap).get()
  let scanned = 0
  let matched = 0
  for (const d of snap.docs) {
    const tx = parseTransaction(d.id, d.data())
    if (tx === null || tx.type === 'transfer' || !couldGive(rule, tx)) continue
    scanned++
    if (applyRules([rule], ruleOperationOf(tx)).applied.length > 0) matched++
  }
  return { matched, scanned, capped: snap.size === cap }
}
