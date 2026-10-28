import type { Firestore } from 'firebase-admin/firestore'
import type { EbBalance, EbTransaction } from '@/lib/domain/banking/map'
import type { BankDeps } from '@/lib/server/banking/deps'
import type { EbApi, EbSession, EbTxPage } from '@/lib/server/banking/eb-api'
import { BankError } from '@/lib/server/banking/errors'
import { ORG, makeDeps } from './helpers'

export const SESSION: EbSession = {
  sessionId: 's1',
  institutionName: 'Millennium',
  institutionCountry: 'PL',
  psuType: 'business',
  validUntil: '2027-01-21T10:00:00.000Z',
  accounts: [{ uid: 'eb-u1', identificationHashes: ['hash-1'], iban: 'PL61109010140000071219812874', currency: 'PLN', name: 'Firmowe' }],
}

export function ebTx(ref: string | null, amount: string, indicator: 'CRDT' | 'DBIT', day: string, over: Partial<EbTransaction> = {}): EbTransaction {
  return {
    ...(ref === null ? {} : { entry_reference: ref }),
    booking_date: day,
    transaction_amount: { amount, currency: 'PLN' },
    credit_debit_indicator: indicator,
    status: 'BOOK',
    creditor: { name: 'ACME' },
    debtor: { name: 'Klient' },
    remittance_information: [`Płatność ${ref ?? amount}`],
    ...over,
  }
}

export interface FakeEb extends EbApi {
  calls: Array<{ uid: string; dateFrom: string; continuationKey: string | null }>
  session: EbSession
  /** Pages keyed by the continuation key ('' for the first page). */
  pages: Record<string, EbTxPage>
  balances: EbBalance[]
  failTransactions: BankError | null
}

export function fakeEb(pages: Record<string, EbTxPage>, balanceAmount = '1000.00'): FakeEb {
  const eb: FakeEb = {
    calls: [],
    session: SESSION,
    pages,
    balances: [{ balance_type: 'CLBD', balance_amount: { amount: balanceAmount, currency: 'PLN' } }],
    failTransactions: null,
    async getSession() {
      return eb.session
    },
    async getBalances() {
      return eb.balances
    },
    async getTransactions(uid, q) {
      eb.calls.push({ uid, dateFrom: q.dateFrom, continuationKey: q.continuationKey ?? null })
      if (eb.failTransactions) throw eb.failTransactions
      return eb.pages[q.continuationKey ?? ''] ?? { transactions: [], continuationKey: null }
    },
  }
  return eb
}

export function bankDeps(db: Firestore, eb: EbApi, now = new Date('2026-10-27T10:00:00Z')): BankDeps {
  const ledger = makeDeps(db, { now: () => now })
  return { db, eb, ledger, now: ledger.now, today: ledger.today }
}

/** A connection and a linked bank account, as `linkAccount` would leave them. Returns the bank account id. */
export async function seedBank(db: Firestore, over: Record<string, unknown> = {}, connection: Record<string, unknown> = {}): Promise<string> {
  await db.doc(`organizations/${ORG}/bankConnections/s1`).set({ orgId: ORG, sessionId: 's1', institutionName: 'Millennium', connectedAt: '2026-10-23T10:00:00.000Z', validUntil: '2027-01-21T10:00:00.000Z', status: 'active', connectedBy: 'user-alice', ...connection })
  await db.doc(`organizations/${ORG}/bankAccounts/ba1`).set({
    orgId: ORG, connectionId: 's1', ebAccountUid: 'eb-u1', identificationHashes: ['hash-1'], iban: 'PL61109010140000071219812874', currency: 'PLN',
    accountId: 'a1', importFrom: '2026-07-30', status: 'active', lastSyncAt: null, syncedThrough: null, cursor: null, syncLock: null,
    bankBalance: null, firstSyncDone: false, ...over,
  })
  return 'ba1'
}
