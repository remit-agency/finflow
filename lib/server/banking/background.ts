import 'server-only'
import type { DocumentReference } from 'firebase-admin/firestore'
import { backgroundSlot } from '@/lib/domain/banking/slot'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { orgRef } from '@/lib/server/ledger/paths'
import { todayDay, warsawHour } from '@/lib/utils/today'
import type { BankDeps } from './deps'
import { BankError } from './errors'
import { bankConnectionsCol } from './paths'
import { syncStep } from './sync'
import { parseBankAccount, parseConnection, type BankAccount, type BankConnection } from './types'

/** A run stops starting new accounts after this long (the route may run for 60 s). */
export const BACKGROUND_BUDGET_MS = 45_000
/** Steps (one bank page, up to 25 new operations each) per account per slot; the rest continues in the next slot. */
export const BACKGROUND_MAX_STEPS = 4
/** The pause after the bank said its limit for fetching without the person present was reached. */
export const BACKOFF_MS = 6 * 3_600_000

/** Counts only: no amounts, IBANs or names, so the answer can be printed in the job log. */
export interface BackgroundSummary {
  slot: string
  /** Accounts that were due in this slot (before their connection was looked at). */
  considered: number
  synced: number
  /** Not touched: busy, access ended, or the time budget ran out. */
  skipped: number
  failed: number
  rateLimited: number
  imported: number
}

interface Candidate {
  orgId: string
  id: string
  ref: DocumentReference
  acc: BankAccount
}

type Outcome =
  | { kind: 'synced'; imported: number }
  | { kind: 'busy' }
  | { kind: 'rate_limited'; imported: number }
  | { kind: 'failed'; imported: number }

function accessLasts(conn: BankConnection | null, today: string): boolean {
  return conn !== null && conn.status === 'active' && todayDay(new Date(conn.validUntil)) >= today
}

async function syncAccount(deps: BankDeps, c: Candidate, uid: string): Promise<Outcome> {
  let imported = 0
  try {
    for (let i = 0; i < BACKGROUND_MAX_STEPS; i++) {
      const r = await syncStep(deps, c.orgId, uid, c.id)
      imported += r.imported
      if (r.done) break
    }
    return { kind: 'synced', imported }
  } catch (e) {
    if (e instanceof BankError && e.code === 'already_running') return { kind: 'busy' }
    if (e instanceof BankError && e.code === 'rate_limited') return { kind: 'rate_limited', imported }
    const code = e instanceof BankError || e instanceof LedgerError ? e.code : 'unknown'
    console.error('bank background sync failed', { orgId: c.orgId, bankAccountId: c.id, code })
    return { kind: 'failed', imported }
  }
}

/**
 * The background refresh: for every active, fully linked bank account that has not been tried in the current slot
 * (see `backgroundSlot`) and is not in a pause, runs `syncStep` (at most BACKGROUND_MAX_STEPS) and marks the slot as used.
 * `deps.eb` must be made without a person (no `psu-*` headers): the bank then counts the call as a background fetch.
 * A slot is used up by any attempt, a failed one too, so a bank outage does not eat the bank's daily limit;
 * only "busy" (the owner is syncing right now) and "out of time" leave it free for the next hourly run.
 */
export async function runBackgroundSync(deps: BankDeps, opts: { budgetMs?: number } = {}): Promise<BackgroundSummary> {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? BACKGROUND_BUDGET_MS
  const now = deps.now()
  const slot = backgroundSlot(todayDay(now), warsawHour(now))
  const summary: BackgroundSummary = { slot, considered: 0, synced: 0, skipped: 0, failed: 0, rateLimited: 0, imported: 0 }

  const snap = await deps.db.collectionGroup('bankAccounts').where('status', '==', 'active').get()
  const due: Candidate[] = []
  for (const doc of snap.docs) {
    const orgId = doc.ref.parent.parent?.id
    const acc = parseBankAccount(doc.data())
    if (!orgId || !acc || !acc.firstSyncDone || acc.bgSlot === slot) continue
    if (acc.backoffUntil !== null && Date.parse(acc.backoffUntil) > now.getTime()) continue
    due.push({ orgId, id: doc.id, ref: doc.ref, acc })
  }
  due.sort((a, b) => a.orgId.localeCompare(b.orgId) || a.id.localeCompare(b.id))
  summary.considered = due.length

  const connections = new Map<string, BankConnection | null>()
  const owners = new Map<string, string | null>()
  const connectionOf = async (c: Candidate): Promise<BankConnection | null> => {
    const key = `${c.orgId}/${c.acc.connectionId}`
    if (!connections.has(key)) {
      const s = await bankConnectionsCol(deps.db, c.orgId).doc(c.acc.connectionId).get()
      connections.set(key, s.exists ? parseConnection(s.data()) : null)
    }
    return connections.get(key) ?? null
  }
  const ownerOf = async (orgId: string): Promise<string | null> => {
    if (!owners.has(orgId)) {
      const s = await orgRef(deps.db, orgId).get()
      const ownerId: unknown = s.exists ? (s.data() as { ownerId?: unknown } | undefined)?.ownerId : undefined
      owners.set(orgId, typeof ownerId === 'string' && ownerId !== '' ? ownerId : null)
    }
    return owners.get(orgId) ?? null
  }

  for (const [i, c] of due.entries()) {
    if (Date.now() - started >= budgetMs) {
      summary.skipped += due.length - i
      break
    }
    if (!accessLasts(await connectionOf(c), deps.today())) {
      summary.skipped++
      continue
    }
    const uid = await ownerOf(c.orgId)
    if (uid === null) {
      console.error('bank background sync: organization has no owner', { orgId: c.orgId })
      summary.failed++
      continue
    }
    const outcome = await syncAccount(deps, c, uid)
    if (outcome.kind === 'busy') {
      summary.skipped++
      continue
    }
    if (outcome.kind === 'synced') summary.synced++
    else if (outcome.kind === 'rate_limited') summary.rateLimited++
    else summary.failed++
    summary.imported += outcome.imported
    await c.ref.update({
      bgSlot: slot,
      ...(outcome.kind === 'rate_limited' ? { backoffUntil: new Date(now.getTime() + BACKOFF_MS).toISOString() } : {}),
    })
  }
  return summary
}
