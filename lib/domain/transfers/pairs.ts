import { daysApart, isDay } from '@/lib/domain/ledger/days'
import { SCHEMA_VERSION, parseBankInfo } from '@/lib/domain/ledger/doc'
import { isMinor } from '@/lib/domain/ledger/money'
import { bankSideOf } from '@/lib/domain/ledger/transfer'
import { TX_STATUSES, TX_TYPES, type TxStatus, type TxType } from '@/lib/domain/ledger/types'
import { MAX_SUGGESTIONS, SUGGEST_MAX_DAYS, type Candidate, type SuggestionSide, type SuggestionsResult, type TransferSuggestion } from './types'

/** The fields the suggestions read selects (Firestore bills the document anyway; the answer stays small). */
export const CANDIDATE_FIELDS = ['schemaVersion', 'type', 'status', 'isRecurring', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'source', 'bank'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A selected operation document as a candidate, or null when it is not a readable v2 operation. */
export function parseCandidate(id: string, data: unknown, version: string): Candidate | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION) return null
  const { type, status, isRecurring, accountId, amountMinor, currency, paymentDate } = data
  if (!(TX_TYPES as readonly unknown[]).includes(type) || !(TX_STATUSES as readonly unknown[]).includes(status)) return null
  if (typeof isRecurring !== 'boolean' || typeof accountId !== 'string' || typeof currency !== 'string') return null
  if (!isMinor(amountMinor) || amountMinor <= 0 || !isDay(paymentDate)) return null
  const c: Candidate = { id, version, type: type as TxType, status: status as TxStatus, isRecurring, accountId, amountMinor, currency, paymentDate }
  if (data.source === 'bank') {
    const bank = parseBankInfo(data.bank)
    if (bank) c.bank = bank
  }
  return c
}

function sideOf(c: Candidate): SuggestionSide {
  const side: SuggestionSide = { id: c.id, version: c.version, accountId: c.accountId, amountMinor: c.amountMinor, currency: c.currency, paymentDate: c.paymentDate }
  if (c.bank?.counterpartyName !== undefined) side.counterpartyName = c.bank.counterpartyName
  if (c.bank?.remittance !== undefined) side.remittance = c.bank.remittance
  return side
}

const later = (p: TransferSuggestion): string => (p.from.paymentDate > p.to.paymentDate ? p.from.paymentDate : p.to.paymentDate)
const desc = (a: string, b: string): number => (a > b ? -1 : a < b ? 1 : 0)

/**
 * The own transfers the journal suggests (S10b): a bank expense and a bank income (`bankSideOf`) of two different accounts,
 * the same amount in the same currency, at most SUGGEST_MAX_DAYS apart. A pair is offered only when each of its sides has
 * exactly one candidate; a side with several (two equal incomes the same week) counts as ambiguous and is left to the
 * person. Newest pairs first (by the later day of the two, then the expense id), at most `max`.
 */
export function findTransferPairs(cands: readonly Candidate[], max: number = MAX_SUGGESTIONS): Omit<SuggestionsResult, 'truncated'> {
  const outs: Candidate[] = []
  const incomes = new Map<string, Candidate[]>()
  for (const c of cands) {
    const side = bankSideOf(c)
    if (side === 'out') outs.push(c)
    else if (side === 'in') {
      const key = `${c.currency}|${c.amountMinor}`
      incomes.set(key, [...(incomes.get(key) ?? []), c])
    }
  }
  const matchesOf = new Map<string, Candidate[]>()
  const outsPerIncome = new Map<string, number>()
  for (const o of outs) {
    const found = (incomes.get(`${o.currency}|${o.amountMinor}`) ?? []).filter(
      (i) => i.accountId !== o.accountId && daysApart(i.paymentDate, o.paymentDate) <= SUGGEST_MAX_DAYS,
    )
    matchesOf.set(o.id, found)
    for (const i of found) outsPerIncome.set(i.id, (outsPerIncome.get(i.id) ?? 0) + 1)
  }
  const pairs: TransferSuggestion[] = []
  for (const o of outs) {
    const found = matchesOf.get(o.id) ?? []
    if (found.length === 1 && outsPerIncome.get(found[0].id) === 1) pairs.push({ from: sideOf(o), to: sideOf(found[0]) })
  }
  const ambiguous = [...matchesOf.values()].filter((f) => f.length > 1).length + [...outsPerIncome.values()].filter((count) => count > 1).length
  pairs.sort((a, b) => desc(later(a), later(b)) || desc(a.from.id, b.from.id))
  return { pairs: pairs.slice(0, max), total: pairs.length, ambiguous }
}
