import 'server-only'
import { isDay } from '@/lib/domain/ledger/days'
import { parseAccount } from '@/lib/domain/ledger/doc'
import { LEDGER_CURRENCIES } from '@/lib/domain/ledger/types'
import type { LinkRequest } from '@/lib/domain/banking/link-input'
import type { BankSessionAccount } from '@/lib/domain/banking/status-types'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import { createAccount } from '@/lib/server/ledger/accounts'
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
  let relinked = 0
  for (const acc of session.accounts) {
    const hit = existing.docs.find((d) => {
      const b = parseBankAccount(d.data())
      if (!b) return false
      if (acc.identificationHashes.length > 0 && b.identificationHashes.length > 0) return acc.identificationHashes.some((h) => b.identificationHashes.includes(h))
      return acc.iban !== null && b.iban !== null && b.iban === acc.iban
    })
    if (!hit) continue
    const before = parseBankAccount(hit.data()) as NonNullable<ReturnType<typeof parseBankAccount>>
    if (before.connectionId !== session.sessionId) oldConnections.add(before.connectionId)
    await hit.ref.update({ connectionId: session.sessionId, ebAccountUid: acc.uid, status: 'active', cursor: null, syncLock: null })
    relinked++
  }

  // An old connection nothing refers to any more disappears.
  for (const oldId of oldConnections) {
    const stillUsed = await bankAccountsCol(deps.db, orgId).where('connectionId', '==', oldId).limit(1).get()
    if (stillUsed.empty) await bankConnectionsCol(deps.db, orgId).doc(oldId).delete()
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
  if (input.mode === 'existing') {
    const snap = await accountsCol(deps.db, orgId).doc(input.accountId as string).get()
    const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!account) throw new BankError('not_found')
    if (account.currency !== currency) throw new BankError('currency_mismatch')
    accountId = account.id
  } else {
    const name = input.name ?? `${conn.institutionName} ${currency}`.trim()
    accountId = (await createAccount(deps.ledger, orgId, uid, { name, type: 'bank', currency, color: ACCOUNT_COLOR, openingMinor: 0 })).id
  }

  const ref = bankAccountsCol(deps.db, orgId).doc()
  await ref.set({
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
  return { bankAccountId: ref.id, accountId }
}

/** Drops the connection. The bank accounts stay (history, `bankSeen`), inactive, so reconnecting relinks them. */
export async function disconnect(deps: BankDeps, orgId: string, connectionId: string): Promise<void> {
  const accounts = await bankAccountsCol(deps.db, orgId).where('connectionId', '==', connectionId).get()
  const batch = deps.db.batch()
  for (const d of accounts.docs) batch.update(d.ref, { status: 'disconnected', syncLock: null, cursor: null })
  batch.delete(bankConnectionsCol(deps.db, orgId).doc(connectionId))
  await batch.commit()
}
