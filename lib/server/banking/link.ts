import 'server-only'
import { createHash } from 'node:crypto'
import { isDay } from '@/lib/domain/ledger/days'
import { parseAccount } from '@/lib/domain/ledger/doc'
import { LEDGER_CURRENCIES } from '@/lib/domain/ledger/types'
import type { LinkRequest } from '@/lib/domain/banking/link-input'
import type { BankSessionAccount } from '@/lib/domain/banking/status-types'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import { createAccount, deleteAccount } from '@/lib/server/ledger/accounts'
import { accountsCol } from '@/lib/server/ledger/paths'
import { todayDay } from '@/lib/utils/today'
import type { BankDeps } from './deps'
import type { EbSession } from './eb-api'
import { BankError } from './errors'
import { bankAccountsCol, bankConnectionsCol } from './paths'
import { parseBankAccount, parseConnection } from './types'

const ACCOUNT_COLOR = '#00c896'

/**
 * Saves a bank session after the OAuth callback (server side, owner only). Bank accounts this company linked
 * before (same identification hash, else same IBAN) are re-pointed to the new session: the link, the start day
 * and every `bankSeen` mark stay, so renewing the access never duplicates anything.
 */
export async function saveSession(deps: BankDeps, orgId: string, uid: string, session: EbSession): Promise<{ connectionId: string; relinked: number; unlinked: number }> {
  await bankConnectionsCol(deps.db, orgId).doc(session.sessionId).set({
    orgId,
    sessionId: session.sessionId,
    institutionName: session.institutionName,
    institutionCountry: session.institutionCountry,
    psuType: session.psuType,
    connectedAt: deps.now().toISOString(),
    validUntil: session.validUntil,
    status: 'active',
    connectedBy: uid,
  })

  const existing = await bankAccountsCol(deps.db, orgId).get()
  const oldConnections = new Set<string>()
  const matched = new Set<string>()
  let relinked = 0
  for (const acc of session.accounts) {
    const hit = existing.docs.find((d) => {
      // One bank account document is matched by one session account in this call.
      if (matched.has(d.id)) return false
      const b = parseBankAccount(d.data())
      if (!b) return false
      // Both currencies known: they must agree.
      if (acc.currency !== null && acc.currency !== b.currency) return false
      if (acc.identificationHashes.length > 0 && b.identificationHashes.length > 0) return acc.identificationHashes.some((h) => b.identificationHashes.includes(h))
      return acc.iban !== null && b.iban !== null && b.iban === acc.iban
    })
    if (!hit) continue
    matched.add(hit.id)
    const before = parseBankAccount(hit.data()) as NonNullable<ReturnType<typeof parseBankAccount>>
    if (before.connectionId !== session.sessionId) oldConnections.add(before.connectionId)
    // Re-activates a disconnected account and resets the run that was in progress.
    await hit.ref.update({ connectionId: session.sessionId, ebAccountUid: acc.uid, status: 'active', cursor: null, syncLock: null })
    relinked++
  }

  // Other connections of this bank that nothing refers to any more go: the ones whose accounts were just moved, and an
  // older one that never had linked accounts (it would show an expired banner for nothing). A connection a bank account
  // still uses stays.
  const sameBank = await bankConnectionsCol(deps.db, orgId).where('institutionName', '==', session.institutionName).get()
  const candidates = new Set<string>([...oldConnections, ...sameBank.docs.map((d) => d.id)])
  candidates.delete(session.sessionId)
  for (const id of candidates) {
    const stillUsed = await bankAccountsCol(deps.db, orgId).where('connectionId', '==', id).limit(1).get()
    if (stillUsed.empty) await bankConnectionsCol(deps.db, orgId).doc(id).delete()
  }
  return { connectionId: session.sessionId, relinked, unlinked: session.accounts.length - relinked }
}

async function loadConnection(deps: BankDeps, orgId: string, connectionId: string) {
  const snap = await bankConnectionsCol(deps.db, orgId).doc(connectionId).get()
  const conn = snap.exists ? parseConnection(snap.data()) : null
  if (!conn) throw new BankError('not_found')
  return conn
}

/** The bank's accounts of a connection, each flagged with whether it is already linked. */
export async function listConnectionAccounts(deps: BankDeps, orgId: string, connectionId: string): Promise<{ accounts: BankSessionAccount[] }> {
  const conn = await loadConnection(deps, orgId, connectionId)
  const session = await deps.eb.getSession(conn.sessionId)
  const linked = new Set<string>()
  for (const d of (await bankAccountsCol(deps.db, orgId).where('connectionId', '==', connectionId).get()).docs) {
    const b = parseBankAccount(d.data())
    if (b && b.status === 'active') linked.add(b.ebAccountUid)
  }
  // The hashes stay on the server.
  return { accounts: session.accounts.map((a) => ({ uid: a.uid, iban: a.iban, currency: a.currency, name: a.name, linked: linked.has(a.uid) })) }
}

export async function linkAccount(deps: BankDeps, orgId: string, uid: string, input: LinkRequest): Promise<{ bankAccountId: string; accountId: string }> {
  if (!isDay(input.importFrom) || input.importFrom < MIN_DAY || input.importFrom > deps.today()) throw new BankError('invalid_input')
  const conn = await loadConnection(deps, orgId, input.connectionId)
  if (conn.status === 'expired' || todayDay(new Date(conn.validUntil)) < deps.today()) throw new BankError('consent_expired')

  const session = await deps.eb.getSession(conn.sessionId)
  const bank = session.accounts.find((a) => a.uid === input.ebAccountUid)
  if (!bank) throw new BankError('not_found')
  const currency = bank.currency
  if (currency === null || !(LEDGER_CURRENCIES as readonly string[]).includes(currency)) throw new BankError('currency_unsupported')

  const linked = await bankAccountsCol(deps.db, orgId).get()
  for (const d of linked.docs) {
    const b = parseBankAccount(d.data())
    if (!b || b.status !== 'active') continue
    const sameBankAccount = (b.connectionId === input.connectionId && b.ebAccountUid === input.ebAccountUid) || bank.identificationHashes.some((h) => b.identificationHashes.includes(h))
    if (sameBankAccount || (input.mode === 'existing' && b.accountId === input.accountId)) throw new BankError('already_linked')
  }

  let accountId: string
  let createdAccount = false
  if (input.mode === 'existing') {
    const snap = await accountsCol(deps.db, orgId).doc(input.accountId as string).get()
    const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!account) throw new BankError('not_found')
    if (account.currency !== currency) throw new BankError('currency_mismatch')
    accountId = account.id
  } else {
    const name = input.name ?? `${conn.institutionName} ${currency}`.trim()
    accountId = (await createAccount(deps.ledger, orgId, uid, { name, type: 'bank', currency, color: ACCOUNT_COLOR, openingMinor: 0 })).id
    createdAccount = true
  }

  // The id is derived from the bank account, so two concurrent links of the same bank account meet on one document.
  const ref = bankAccountsCol(deps.db, orgId).doc(bankAccountDocId(orgId, { ...bank, connectionId: input.connectionId }))
  try {
    await ref.create({
      orgId,
      connectionId: input.connectionId,
      ebAccountUid: bank.uid,
      identificationHashes: bank.identificationHashes,
      iban: bank.iban,
      currency,
      accountId,
      importFrom: input.importFrom,
      status: 'active',
      lastSyncAt: null,
      syncedThrough: null,
      cursor: null,
      syncLock: null,
      bankBalance: null,
      firstSyncDone: false,
    })
  } catch (e) {
    if (createdAccount) {
      // The loser of a race leaves no FinFlow account behind. (It has no operations, so the delete is allowed.)
      await deleteAccount(deps.ledger, orgId, uid, accountId).catch(() => undefined)
    }
    if (isAlreadyExists(e)) throw new BankError('already_linked')
    throw e
  }
  return { bankAccountId: ref.id, accountId }
}

/** `ba_` + 24 hex characters of sha256(org, bank account identity). The identity is the first identification hash, else the IBAN. */
export function bankAccountDocId(
  orgId: string,
  bank: { identificationHashes: string[]; iban: string | null; uid: string; connectionId: string },
): string {
  const identity = bank.identificationHashes[0] ?? bank.iban ?? `${bank.connectionId}:${bank.uid}`
  return `ba_${createHash('sha256').update(`${orgId}:${identity}`).digest('hex').slice(0, 24)}`
}

/** Firestore's ALREADY_EXISTS (gRPC code 6) from `create()`. */
function isAlreadyExists(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 6
}

/** Drops the connection. The bank accounts stay (history, `bankSeen`), inactive, so reconnecting relinks them. */
export async function disconnect(deps: BankDeps, orgId: string, connectionId: string): Promise<void> {
  const accounts = await bankAccountsCol(deps.db, orgId).where('connectionId', '==', connectionId).get()
  const batch = deps.db.batch()
  for (const d of accounts.docs) batch.update(d.ref, { status: 'disconnected', syncLock: null, cursor: null })
  batch.delete(bankConnectionsCol(deps.db, orgId).doc(connectionId))
  await batch.commit()
}
