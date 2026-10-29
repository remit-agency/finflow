export interface BankConnection {
  /** The Enable Banking session id (also the document id). */
  sessionId: string
  institutionName: string
  /** Null for a connection saved by the old browser flow (renewal then assumes Poland). */
  institutionCountry: string | null
  /** Business or personal access. A document of the old browser flow (no psuType, no validUntil) was always personal. */
  psuType: 'business' | 'personal' | null
  connectedAt: string
  /** ISO instant the bank access ends. */
  validUntil: string
  status: 'active' | 'expired'
}

export interface BankCursor {
  /** First day asked from the bank in this run (stable across the steps of one run). */
  from: string
  continuationKey: string | null
  /** The Warsaw day the run started; becomes `syncedThrough` when it finishes. */
  startedOn: string
}

export interface BankAccount {
  connectionId: string
  ebAccountUid: string
  identificationHashes: string[]
  iban: string | null
  currency: string
  /** The FinFlow account. */
  accountId: string
  importFrom: string
  status: 'active' | 'disconnected'
  lastSyncAt: string | null
  syncedThrough: string | null
  cursor: BankCursor | null
  syncLock: { until: number; token: string } | null
  bankBalance: { amountMinor: number; type: string; at: string } | null
  firstSyncDone: boolean
}

const NINETY_DAYS_MS = 90 * 86_400_000

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * A connection document. One saved by the old browser flow (S00) has neither `validUntil` nor `psuType`: the access
 * was requested for 90 days from `connectedAt`, always as personal access, so that is what it gets. A new document
 * with `psuType` null stays null. Null when the document cannot be read.
 */
export function parseConnection(data: unknown): BankConnection | null {
  const d = rec(data)
  if (!d || typeof d.sessionId !== 'string' || typeof d.connectedAt !== 'string') return null
  const connectedMs = Date.parse(d.connectedAt)
  if (Number.isNaN(connectedMs)) return null
  const validUntil = typeof d.validUntil === 'string' && !Number.isNaN(Date.parse(d.validUntil)) ? d.validUntil : new Date(connectedMs + NINETY_DAYS_MS).toISOString()
  const legacyBrowserFlow = !Object.hasOwn(d, 'psuType') && !Object.hasOwn(d, 'validUntil')
  return {
    sessionId: d.sessionId,
    institutionName: typeof d.institutionName === 'string' ? d.institutionName : '',
    institutionCountry: typeof d.institutionCountry === 'string' ? d.institutionCountry : null,
    psuType: legacyBrowserFlow ? 'personal' : d.psuType === 'business' || d.psuType === 'personal' ? d.psuType : null,
    connectedAt: d.connectedAt,
    validUntil,
    status: d.status === 'expired' ? 'expired' : 'active',
  }
}

export function parseBankAccount(data: unknown): BankAccount | null {
  const d = rec(data)
  if (!d) return null
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  if (typeof d.connectionId !== 'string' || typeof d.ebAccountUid !== 'string' || typeof d.accountId !== 'string') return null
  if (typeof d.currency !== 'string' || typeof d.importFrom !== 'string') return null
  const cursor = rec(d.cursor)
  const lock = rec(d.syncLock)
  const balance = rec(d.bankBalance)
  return {
    connectionId: d.connectionId,
    ebAccountUid: d.ebAccountUid,
    identificationHashes: Array.isArray(d.identificationHashes) ? d.identificationHashes.filter((h): h is string => typeof h === 'string') : [],
    iban: str(d.iban),
    currency: d.currency,
    accountId: d.accountId,
    importFrom: d.importFrom,
    status: d.status === 'disconnected' ? 'disconnected' : 'active',
    lastSyncAt: str(d.lastSyncAt),
    syncedThrough: str(d.syncedThrough),
    cursor: cursor && typeof cursor.from === 'string' && typeof cursor.startedOn === 'string'
      ? { from: cursor.from, continuationKey: str(cursor.continuationKey), startedOn: cursor.startedOn }
      : null,
    syncLock: lock && typeof lock.until === 'number' && typeof lock.token === 'string' ? { until: lock.until, token: lock.token } : null,
    bankBalance: balance && typeof balance.amountMinor === 'number' && typeof balance.type === 'string' && typeof balance.at === 'string'
      ? { amountMinor: balance.amountMinor, type: balance.type, at: balance.at }
      : null,
    firstSyncDone: d.firstSyncDone === true,
  }
}
