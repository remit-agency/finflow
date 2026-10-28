import { isDay } from '@/lib/domain/ledger/days'
import { isId } from '@/lib/domain/ledger/guards'
import { isMinor } from '@/lib/domain/ledger/money'
import { TX_STATUSES, TX_TYPES, type LedgerTransaction, type TxStatus, type TxType } from '@/lib/domain/ledger/types'

export type DateBasis = 'payment' | 'accrual'

export interface JournalFilters {
  /** Inclusive days, compared with the payment date or with the accrual date or period (`basis`). */
  from?: string
  to?: string
  basis: DateBasis
  /** Free text: account name, counterparty name, comment. */
  q?: string
  /** Inclusive, in the minor units of the operation's own currency. */
  minMinor?: number
  maxMinor?: number
  counterpartyIds: string[]
  types: TxType[]
  status?: TxStatus
  accountId?: string
  categoryIds: string[]
}

export const EMPTY_FILTERS: JournalFilters = { basis: 'payment', counterpartyIds: [], types: [], categoryIds: [] }

const MAX_LIST = 30
const MAX_QUERY = 100

/** Lower case, no diacritics; `ł` has no decomposition, so it is mapped by hand. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
}

function ids(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .filter((s) => isId(s))
    .slice(0, MAX_LIST)
}

function minor(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return isMinor(n) ? n : undefined
}

/** Lenient on purpose: a hand-edited link with a bad value just loses that value. */
export function parseFilters(p: URLSearchParams): JournalFilters {
  const f: JournalFilters = { ...EMPTY_FILTERS, counterpartyIds: ids(p.get('cp')), categoryIds: ids(p.get('cat')) }
  const from = p.get('from')
  const to = p.get('to')
  if (isDay(from)) f.from = from
  if (isDay(to)) f.to = to
  if (p.get('basis') === 'accrual') f.basis = 'accrual'
  const q = p.get('q')?.trim()
  if (q) f.q = q.slice(0, MAX_QUERY)
  const min = minor(p.get('min'))
  const max = minor(p.get('max'))
  if (min !== undefined) f.minMinor = min
  if (max !== undefined) f.maxMinor = max
  f.types = (p.get('types') ?? '')
    .split(',')
    .filter((t): t is TxType => (TX_TYPES as readonly string[]).includes(t))
  const status = p.get('status')
  if (status !== null && (TX_STATUSES as readonly string[]).includes(status)) f.status = status as TxStatus
  const account = p.get('account')
  if (isId(account)) f.accountId = account
  return f
}

export function filtersToParams(f: JournalFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.basis === 'accrual') p.set('basis', 'accrual')
  if (f.q) p.set('q', f.q)
  if (f.minMinor !== undefined) p.set('min', String(f.minMinor))
  if (f.maxMinor !== undefined) p.set('max', String(f.maxMinor))
  if (f.counterpartyIds.length) p.set('cp', f.counterpartyIds.join(','))
  if (f.types.length) p.set('types', f.types.join(','))
  if (f.status) p.set('status', f.status)
  if (f.accountId) p.set('account', f.accountId)
  if (f.categoryIds.length) p.set('cat', f.categoryIds.join(','))
  return p
}

/** True when something narrows the list; the date basis alone narrows nothing. */
export function hasActiveFilters(f: JournalFilters): boolean {
  return (
    f.from !== undefined ||
    f.to !== undefined ||
    !!f.q ||
    f.minMinor !== undefined ||
    f.maxMinor !== undefined ||
    f.counterpartyIds.length > 0 ||
    f.types.length > 0 ||
    f.status !== undefined ||
    f.accountId !== undefined ||
    f.categoryIds.length > 0
  )
}

/** Names the text search looks in. */
export interface FilterContext {
  accountName: (id: string) => string | undefined
  counterpartyName: (id: string) => string | undefined
}

function accrualBounds(tx: LedgerTransaction): { from: string; to: string } {
  return tx.accrual.mode === 'date' ? { from: tx.accrual.date, to: tx.accrual.date } : { from: tx.accrual.from, to: tx.accrual.to }
}

/** The whole predicate, so the in-memory part of a page read and the tests use one definition. */
export function matchesFilters(tx: LedgerTransaction, f: JournalFilters, ctx: FilterContext): boolean {
  if (f.types.length && !f.types.includes(tx.type)) return false
  if (f.status && tx.status !== f.status) return false
  if (f.minMinor !== undefined && tx.amountMinor < f.minMinor) return false
  if (f.maxMinor !== undefined && tx.amountMinor > f.maxMinor) return false
  if (f.categoryIds.length && (tx.categoryId === undefined || !f.categoryIds.includes(tx.categoryId))) return false
  if (f.counterpartyIds.length && (tx.counterpartyId === undefined || !f.counterpartyIds.includes(tx.counterpartyId))) return false
  if (f.accountId && tx.accountId !== f.accountId && tx.toAccountId !== f.accountId) return false

  if (f.from !== undefined || f.to !== undefined) {
    const range = f.basis === 'payment' ? { from: tx.paymentDate, to: tx.paymentDate } : accrualBounds(tx)
    if (f.from !== undefined && range.to < f.from) return false
    if (f.to !== undefined && range.from > f.to) return false
  }

  if (f.q) {
    const hay = [
      ctx.accountName(tx.accountId),
      tx.toAccountId === undefined ? undefined : ctx.accountName(tx.toAccountId),
      tx.counterpartyId === undefined ? undefined : ctx.counterpartyName(tx.counterpartyId),
      tx.description,
    ]
      .filter((s): s is string => !!s)
      .map(normalizeText)
    const words = normalizeText(f.q).split(/\s+/).filter(Boolean)
    if (!words.every((w) => hay.some((h) => h.includes(w)))) return false
  }
  return true
}
