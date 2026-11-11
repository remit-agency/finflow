// lib/domain/reports/facts.ts
// What a report counts, in one shape for both paths (S12): read from the stored rollups, or recomputed from the operations
// with the ledger's own rule (`contributions`). No second copy of the amount, base, transfer-day or `excluded` rules, so
// the two paths can only differ where the stored rollups drifted from the operations.
import { isDay, isMonth, monthsBetween, overlapDays } from '@/lib/domain/ledger/days'
import { addInto, contributions, EXCLUDED_PREFIX, type RollupDocs, type RollupFlat } from '@/lib/domain/ledger/rollups'
import type { Accrual, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { CashCell, CategoryAmounts, ReportFacts, ReportKind } from './types'

/** A period of UTC days, both included. */
export interface DayRange {
  from: string
  to: string
}

export type RollupPart = 'cash' | 'cashcat' | 'pl'

export type RollupRef =
  | { kind: 'cash'; excluded: boolean; accountId: string; day: string }
  | { kind: 'cashcat' | 'pl'; excluded: boolean; month: string }

/** What a rollup document id names (`cash_{account}_{day}`, `cashcat_{month}`, `pl_{month}`, each with its `x_` twin), or null. */
export function parseRollupId(id: string): RollupRef | null {
  const excluded = id.startsWith(EXCLUDED_PREFIX)
  const rest = excluded ? id.slice(EXCLUDED_PREFIX.length) : id
  if (rest.startsWith('cashcat_')) {
    const month = rest.slice('cashcat_'.length)
    return isMonth(month) ? { kind: 'cashcat', excluded, month } : null
  }
  if (rest.startsWith('cash_')) {
    // The day is the last 10 characters; the account id is everything between `cash_` and `_{day}` (it may hold a `_`).
    const day = rest.slice(-10)
    const accountId = rest.slice('cash_'.length, -11)
    return accountId !== '' && rest.charAt(rest.length - 11) === '_' && isDay(day) ? { kind: 'cash', excluded, accountId, day } : null
  }
  if (rest.startsWith('pl_')) {
    const month = rest.slice('pl_'.length)
    return isMonth(month) ? { kind: 'pl', excluded, month } : null
  }
  return null
}

export function emptyFacts(): ReportFacts {
  return { cash: new Map(), excludedCash: new Map(), cashCategories: new Map(), excludedCashCategories: new Map(), pl: new Map(), excludedPl: new Map() }
}

function cellOf(flat: RollupFlat): CashCell {
  return {
    inMinor: flat.inMinor ?? 0,
    outMinor: flat.outMinor ?? 0,
    inBase: flat.inBase ?? 0,
    outBase: flat.outBase ?? 0,
    transferInMinor: flat.transferInMinor ?? 0,
    transferOutMinor: flat.transferOutMinor ?? 0,
  }
}

/** `categories.<key>.incomeBase|expenseBase` of a month document, by stored category key. */
function categoriesOf(flat: RollupFlat): Map<string, CategoryAmounts> {
  const out = new Map<string, CategoryAmounts>()
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    if (parts.length !== 3 || parts[0] !== 'categories') continue
    const amounts = out.get(parts[1]) ?? { incomeBase: 0, expenseBase: 0 }
    if (parts[2] === 'incomeBase') amounts.incomeBase += value
    else if (parts[2] === 'expenseBase') amounts.expenseBase += value
    else continue
    out.set(parts[1], amounts)
  }
  return out
}

function addCategories(target: Map<string, CategoryAmounts>, source: Map<string, CategoryAmounts>): void {
  for (const [key, a] of source) {
    const t = target.get(key) ?? { incomeBase: 0, expenseBase: 0 }
    t.incomeBase += a.incomeBase
    t.expenseBase += a.expenseBase
    target.set(key, t)
  }
}

/** The facts of a set of rollup documents (stored ones, or `operationRollups`); unknown ids are ignored. */
export function factsFromRollupDocs(docs: RollupDocs): ReportFacts {
  const facts = emptyFacts()
  for (const [id, flat] of docs) {
    const ref = parseRollupId(id)
    if (ref === null) continue
    if (ref.kind === 'cash') {
      const target = ref.excluded ? facts.excludedCash : facts.cash
      const days = target.get(ref.accountId) ?? new Map<string, CashCell>()
      days.set(ref.day, cellOf(flat))
      target.set(ref.accountId, days)
    } else if (ref.kind === 'cashcat') {
      addCategories(ref.excluded ? facts.excludedCashCategories : facts.cashCategories, categoriesOf(flat))
    } else {
      const target = ref.excluded ? facts.excludedPl : facts.pl
      const month = target.get(ref.month) ?? new Map<string, CategoryAmounts>()
      addCategories(month, categoriesOf(flat))
      target.set(ref.month, month)
    }
  }
  return facts
}

/**
 * The stored rollups a report of `kind` over whole months reads: the daily documents of `accounts` inside the period and
 * the month documents of the kind (`cashcat_` for Cash Flow, `pl_` for P&L). The server reads by these id ranges and runs
 * the answer through this too, so the property test checks the same selection.
 */
export function selectRollupDocs(docs: RollupDocs, accounts: ReadonlySet<string>, range: DayRange, kind: ReportKind): RollupDocs {
  const months = new Set(monthsBetween(range.from, range.to))
  const out: RollupDocs = new Map()
  for (const [id, flat] of docs) {
    const ref = parseRollupId(id)
    if (ref === null) continue
    const keep =
      ref.kind === 'cash'
        ? accounts.has(ref.accountId) && ref.day >= range.from && ref.day <= range.to
        : ref.kind === 'cashcat'
          ? kind === 'cashflow' && months.has(ref.month)
          : kind === 'pl' && months.has(ref.month)
    if (keep) out.set(id, flat)
  }
  return out
}

/** `value * num / den` in whole minor units, half away from zero; exact through BigInt. */
export function mulDivRound(value: number, num: number, den: number): number {
  const sign = value < 0 ? BigInt(-1) : BigInt(1)
  const q = (BigInt(Math.abs(value)) * BigInt(num) * BigInt(2) + BigInt(den)) / (BigInt(2) * BigInt(den))
  return Number(sign * q)
}

/**
 * The part of a month's P&L share of an operation that falls in the period: days of `month` inside both the accrual and
 * the period, over days of `month` inside the accrual. A whole month inside the period is `inside === whole`.
 */
export function accrualShare(accrual: Accrual, month: string, range: DayRange): { inside: number; whole: number } {
  const from = accrual.mode === 'date' ? accrual.date : accrual.from
  const to = accrual.mode === 'date' ? accrual.date : accrual.to
  const whole = overlapDays(month, from, to)
  const lo = from > range.from ? from : range.from
  const hi = to < range.to ? to : range.to
  return { inside: lo > hi ? 0 : overlapDays(month, lo, hi), whole }
}

function scaled(flat: RollupFlat, inside: number, whole: number): RollupFlat {
  const out: RollupFlat = {}
  for (const [field, value] of Object.entries(flat)) {
    const part = mulDivRound(value, inside, whole)
    if (part !== 0) out[field] = part
  }
  return out
}

export interface OperationRollupOptions {
  /** The accounts whose daily documents count (every account when absent). */
  accounts?: ReadonlySet<string>
  parts: readonly RollupPart[]
}

/**
 * The rollup documents the operations would add, restricted to the period: the days of the period (`cash_`, the money in
 * of a transfer on its arrival day), the operations paid in the period (`cashcat_`), and the share of the period of each
 * accrual month (`pl_`, `accrualShare`). Planned operations add nothing; an operation that cannot be counted (another
 * currency without base amounts) is listed in `uncountable`, never counted as zero.
 */
export function operationRollups(
  ops: readonly LedgerTransaction[],
  baseCurrency: string,
  range: DayRange,
  opts: OperationRollupOptions,
): { docs: RollupDocs; uncountable: string[] } {
  const docs: RollupDocs = new Map()
  const uncountable: string[] = []
  for (const tx of ops) {
    if (tx.status !== 'actual') continue
    let own: RollupDocs
    try {
      own = contributions(tx, baseCurrency)
    } catch {
      uncountable.push(tx.id)
      continue
    }
    const kept: RollupDocs = new Map()
    for (const [id, flat] of own) {
      const ref = parseRollupId(id)
      if (ref === null || !opts.parts.includes(ref.kind)) continue
      if (ref.kind === 'cash') {
        if (ref.day < range.from || ref.day > range.to) continue
        if (opts.accounts !== undefined && !opts.accounts.has(ref.accountId)) continue
        kept.set(id, flat)
      } else if (ref.kind === 'cashcat') {
        if (tx.paymentDate >= range.from && tx.paymentDate <= range.to) kept.set(id, flat)
      } else {
        const { inside, whole } = accrualShare(tx.accrual, ref.month, range)
        if (inside > 0) kept.set(id, inside === whole ? flat : scaled(flat, inside, whole))
      }
    }
    addInto(docs, kept)
  }
  return { docs, uncountable }
}
