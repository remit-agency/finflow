import 'server-only'
import type { EbBalance, EbTransaction } from '@/lib/domain/banking/map'
import { BankError, type BankErrorCode } from './errors'

export interface Psu {
  ip?: string
  userAgent?: string
}

export interface EbAccount {
  uid: string
  /** Hashes of the account identifiers: the bank's way to recognise one account across sessions. */
  identificationHashes: string[]
  iban: string | null
  currency: string | null
  name: string | null
}

export interface EbSession {
  sessionId: string
  institutionName: string
  /** ISO country code of the bank (needed to renew the access with the same bank). */
  institutionCountry: string | null
  /** The kind of customer the access was granted for. */
  psuType: 'business' | 'personal' | null
  /** ISO instant the access ends. */
  validUntil: string
  accounts: EbAccount[]
}

export interface EbTxPage {
  transactions: EbTransaction[]
  continuationKey: string | null
}

/** What S09 needs from Enable Banking. The tests replace it with an in-memory bank. */
export interface EbApi {
  getSession(sessionId: string): Promise<EbSession>
  getBalances(accountUid: string): Promise<EbBalance[]>
  getTransactions(accountUid: string, query: { dateFrom: string; continuationKey?: string | null }): Promise<EbTxPage>
}

/** A bank request that does not answer within this time counts as the bank being unavailable (the route has 60 s). */
export const REQUEST_TIMEOUT_MS = 20_000

export interface EbApiOptions {
  /** Defaults to EB_API_BASE, then the real API (the e2e tests point it at a local fake bank). */
  base?: string
  token: () => Promise<string>
  psu?: Psu
  fetchImpl?: typeof fetch
}

/**
 * The code of a failed Enable Banking answer. The patterns are a first guess from the API documentation;
 * refine them with what the real bank answers (see the spike results in the spec).
 */
export function classifyEbFailure(status: number, body: string): BankErrorCode {
  const b = body.toLowerCase()
  if (status === 429 || /rate.?limit|too many/.test(b)) return 'rate_limited'
  // Our own credentials are wrong: not the person's consent.
  if (/jwt|signature|\bkid\b/.test(b)) return 'bank_error'
  if ([401, 403, 404, 422].includes(status) && /session|consent|expired|closed|revoked/.test(b)) return 'consent_expired'
  if (status >= 500) return 'bank_unavailable'
  return 'bank_error'
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function hashes(a: Record<string, unknown>): string[] {
  const all = [a.identification_hash, ...(Array.isArray(a.identification_hashes) ? a.identification_hashes : [])]
  return [...new Set(all.filter((h): h is string => typeof h === 'string' && h !== ''))]
}

function normalizeAccount(raw: unknown): EbAccount | null {
  if (typeof raw === 'string') return raw === '' ? null : { uid: raw, identificationHashes: [], iban: null, currency: null, name: null }
  const a = rec(raw)
  const uid = a ? str(a.uid) : null
  if (!a || !uid) return null
  return {
    uid,
    identificationHashes: hashes(a),
    iban: str(rec(a.account_id)?.iban),
    currency: str(a.currency),
    name: str(a.name),
  }
}

export function normalizeSession(sessionId: string, json: unknown): EbSession {
  const body = rec(json) ?? {}
  const list = Array.isArray(body.accounts_data) && body.accounts_data.length > 0 ? body.accounts_data : Array.isArray(body.accounts) ? body.accounts : []
  const validUntil = str(rec(body.access)?.valid_until)
  return {
    sessionId,
    institutionName: str(rec(body.aspsp)?.name) ?? '',
    institutionCountry: str(rec(body.aspsp)?.country),
    psuType: body.psu_type === 'business' || body.psu_type === 'personal' ? body.psu_type : null,
    // We asked for 90 days; use that when the bank's answer does not say.
    validUntil: validUntil !== null && !Number.isNaN(Date.parse(validUntil)) ? validUntil : new Date(Date.now() + 90 * 86_400_000).toISOString(),
    accounts: list.map(normalizeAccount).filter((a): a is EbAccount => a !== null),
  }
}

function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 200)
}

export function createEbApi(opts: EbApiOptions): EbApi {
  const base = opts.base ?? process.env.EB_API_BASE ?? 'https://api.enablebanking.com'
  const doFetch = opts.fetchImpl ?? fetch

  async function get(pathAndQuery: string): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await opts.token()}` }
    if (opts.psu?.ip) headers['psu-ip-address'] = opts.psu.ip
    if (opts.psu?.userAgent) headers['psu-user-agent'] = opts.psu.userAgent
    let res: Response
    try {
      res = await doFetch(`${base}${pathAndQuery}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch {
      throw new BankError('bank_unavailable')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('Enable Banking call failed:', res.status, sanitize(text))
      throw new BankError(classifyEbFailure(res.status, text))
    }
    return res.json().catch(() => null)
  }

  return {
    async getSession(sessionId) {
      const session = normalizeSession(sessionId, await get(`/sessions/${encodeURIComponent(sessionId)}`))
      // The session names its accounts by uid and hashes only; IBAN, currency and name are in each account's details.
      const accounts: EbAccount[] = []
      for (const account of session.accounts) {
        if (account.iban !== null && account.currency !== null) {
          accounts.push(account)
          continue
        }
        const details = rec(await get(`/accounts/${encodeURIComponent(account.uid)}/details`))
        accounts.push({
          ...account,
          iban: account.iban ?? str(rec(details?.account_id)?.iban),
          currency: account.currency ?? str(details?.currency),
          name: account.name ?? str(details?.name),
        })
      }
      return { ...session, accounts }
    },
    async getBalances(accountUid) {
      const body = rec(await get(`/accounts/${encodeURIComponent(accountUid)}/balances`))
      return Array.isArray(body?.balances) ? (body.balances as EbBalance[]) : []
    },
    async getTransactions(accountUid, query) {
      const q = new URLSearchParams({ date_from: query.dateFrom, transaction_status: 'BOOK' })
      if (query.continuationKey) q.set('continuation_key', query.continuationKey)
      const body = rec(await get(`/accounts/${encodeURIComponent(accountUid)}/transactions?${q}`))
      return {
        transactions: Array.isArray(body?.transactions) ? (body.transactions as EbTransaction[]) : [],
        continuationKey: str(body?.continuation_key),
      }
    },
  }
}
