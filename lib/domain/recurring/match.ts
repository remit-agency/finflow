import { addDays, isDay } from '@/lib/domain/ledger/days'
import { SCHEMA_VERSION, parseBankInfo } from '@/lib/domain/ledger/doc'
import { isMinor } from '@/lib/domain/ledger/money'
import { bankKeyOf } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { sameTags } from '@/lib/domain/tags/assign'
import { parsePlannedRow } from './rows'
import { MATCH_AFTER_DAYS, MATCH_BEFORE_DAYS, MAX_MATCHES, type BankSide, type Carried, type MatchSuggestions, type PlanMatch, type PlanSide } from './types'

/** The fields the bank side of the suggestions selects. */
export const BANK_FIELDS = ['schemaVersion', 'type', 'status', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'source', 'bank', 'seriesId', 'counterpartyId'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A plan a bank operation can pay: a planned income or expense of a series, not changed by hand. Null otherwise. */
export function parsePlanSide(id: string, data: unknown, version: string): PlanSide | null {
  const row = parsePlannedRow(id, data)
  if (row === null || row.seriesId === undefined || row.occurrence === undefined || row.manual || row.type === 'transfer') return null
  const side: PlanSide = {
    id, version, type: row.type, accountId: row.accountId, amountMinor: row.amountMinor, currency: row.currency, paymentDate: row.paymentDate,
    seriesId: row.seriesId, occurrence: row.occurrence, estimated: row.estimated,
  }
  if (row.counterpartyId !== undefined) side.counterpartyId = row.counterpartyId
  if (row.description !== undefined) side.description = row.description
  return side
}

/** A bank operation that can pay a plan: an actual bank income or expense under its `bk_` id that pays no plan yet. */
export function parseBankSide(id: string, data: unknown, version: string): BankSide | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION || data.status !== 'actual') return null
  const { type, accountId, amountMinor, currency, paymentDate } = data
  if (type !== 'income' && type !== 'expense') return null
  if (bankKeyOf(id) === null || data.source !== 'bank' || data.seriesId !== undefined) return null
  const bank = parseBankInfo(data.bank)
  if (bank === null) return null
  if (typeof accountId !== 'string' || !isMinor(amountMinor) || amountMinor <= 0 || typeof currency !== 'string' || !isDay(paymentDate)) return null
  const side: BankSide = { id, version, type, accountId, amountMinor, currency, paymentDate }
  if (typeof data.counterpartyId === 'string') side.counterpartyId = data.counterpartyId
  if (bank.counterpartyName !== undefined) side.counterpartyName = bank.counterpartyName
  if (bank.remittance !== undefined) side.remittance = bank.remittance
  return side
}

/**
 * Whether a bank operation can be the payment of a plan (S11): the same kind and account, its day from MATCH_BEFORE_DAYS
 * before to MATCH_AFTER_DAYS after the plan's payment day; the exact amount for an exact plan, the same counterparty for an
 * estimate (a plan without a counterparty is never matched as an estimate).
 */
export function canMatch(plan: PlanSide, bank: BankSide): boolean {
  if (plan.type !== bank.type || plan.accountId !== bank.accountId) return false
  if (bank.paymentDate < addDays(plan.paymentDate, -MATCH_BEFORE_DAYS) || bank.paymentDate > addDays(plan.paymentDate, MATCH_AFTER_DAYS)) return false
  if (plan.estimated) return plan.counterpartyId !== undefined && bank.counterpartyId === plan.counterpartyId
  return plan.amountMinor === bank.amountMinor && plan.currency === bank.currency
}

export const matchKey = (planId: string, bankId: string): string => `${planId}|${bankId}`
export const keyOfMatch = (m: PlanMatch): string => matchKey(m.plan.id, m.bank.id)

const desc = (a: string, b: string): number => (a > b ? -1 : a < b ? 1 : 0)

/**
 * The plan ↔ bank pairs the journal suggests (S11). A pair is offered only when the plan has exactly one bank candidate and
 * that bank operation exactly one plan; sides with several count as ambiguous and are left to the person. Newest first (by
 * the bank day, then the plan id), at most `max`.
 */
export function findPlanMatches(plans: readonly PlanSide[], banks: readonly BankSide[], max: number = MAX_MATCHES): Omit<MatchSuggestions, 'truncated'> {
  const banksOf = new Map<string, BankSide[]>()
  const plansPerBank = new Map<string, number>()
  for (const p of plans) {
    const found = banks.filter((b) => canMatch(p, b))
    banksOf.set(p.id, found)
    for (const b of found) plansPerBank.set(b.id, (plansPerBank.get(b.id) ?? 0) + 1)
  }
  const pairs: PlanMatch[] = []
  for (const p of plans) {
    const found = banksOf.get(p.id) ?? []
    if (found.length === 1 && plansPerBank.get(found[0].id) === 1) pairs.push({ plan: p, bank: found[0] })
  }
  const ambiguous = [...banksOf.values()].filter((f) => f.length > 1).length + [...plansPerBank.values()].filter((n) => n > 1).length
  pairs.sort((a, b) => desc(a.bank.paymentDate, b.bank.paymentDate) || desc(a.plan.id, b.plan.id))
  return { pairs: pairs.slice(0, max), total: pairs.length, ambiguous }
}

/** What a confirmed match copies from the plan: each of category, counterparty, comment and tags only when the bank operation has none. */
export function carriedOf(plan: LedgerTransaction, bank: LedgerTransaction): Carried {
  const c: Carried = {}
  if (bank.categoryId === undefined && plan.categoryId !== undefined) c.categoryId = plan.categoryId
  if (bank.counterpartyId === undefined && plan.counterpartyId !== undefined) c.counterpartyId = plan.counterpartyId
  if (bank.description === undefined && plan.description !== undefined) c.description = plan.description
  if (bank.tags.length === 0 && plan.tags.length > 0) c.tags = [...plan.tags]
  return c
}

/** The bank operation with the carried fields (its rules trace, amount, day and bank block untouched). */
export function withCarried(bank: LedgerTransaction, c: Carried): LedgerTransaction {
  const out: LedgerTransaction = { ...bank }
  if (c.categoryId !== undefined) out.categoryId = c.categoryId
  if (c.counterpartyId !== undefined) out.counterpartyId = c.counterpartyId
  if (c.description !== undefined) out.description = c.description
  if (c.tags !== undefined) out.tags = [...c.tags]
  return out
}

/** The undo of a match: the series link goes, and each carried field the bank operation still has unchanged. */
export function withoutCarried(bank: LedgerTransaction, c: Carried): LedgerTransaction {
  const out: LedgerTransaction = { ...bank }
  if (c.categoryId !== undefined && out.categoryId === c.categoryId) delete out.categoryId
  if (c.counterpartyId !== undefined && out.counterpartyId === c.counterpartyId) delete out.counterpartyId
  if (c.description !== undefined && out.description === c.description) delete out.description
  if (c.tags !== undefined && sameTags(out.tags, c.tags)) out.tags = []
  delete out.seriesId
  delete out.occurrence
  delete out.estimated
  delete out.manual
  return out
}
