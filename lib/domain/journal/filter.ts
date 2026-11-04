import { isDay } from '@/lib/domain/ledger/days'
import { isId } from '@/lib/domain/ledger/guards'
import { isMinor } from '@/lib/domain/ledger/money'
import { TX_STATUSES, TX_TYPES, type LedgerTransaction, type TxStatus, type TxType } from '@/lib/domain/ledger/types'

export type DateBasis = 'payment' | 'accrual'

/** `tg=_none`: the operations without any tag (S10t). Tag ids are Firestore auto ids, so they are never `_none`. */
export const NO_TAG = '_none'

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
  /** Any of these tags (S10t); `NO_TAG` stands for «без тегів». */
  tagIds: string[]
  /** Only the operations excluded from analytics (S10t). */
  excludedOnly: boolean
}

export const EMPTY_FILTERS: JournalFilters = { basis: 'payment', counterpartyIds: [], types: [], categoryIds: [], tagIds: [], excludedOnly: false }

/** Ids one list filter keeps (`cp`, `cat`, `tg`; the reports' `accounts` too, S10f); the rest of a hand-made link is dropped. */
export const MAX_FILTER_IDS = 30
const MAX_QUERY = 100

/** Lower case, no diacritics; `ł` has no decomposition, so it is mapped by hand. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
}

/**
 * A comma-separated list of ids from the address: what is not an id is dropped, a repeat is dropped, and only then at most
 * `MAX_FILTER_IDS` stay (a repeat does not use up a place).
 */
export function idList(raw: string | null): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').filter((s) => isId(s)))].slice(0, MAX_FILTER_IDS)
}

/** A comma-separated list of operation types from the address; anything else is dropped, a repeat too. */
export function typeList(raw: string | null): TxType[] {
  const types = (raw ?? '').split(',').filter((t): t is TxType => (TX_TYPES as readonly string[]).includes(t))
  return [...new Set(types)]
}

function minor(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return isMinor(n) ? n : undefined
}

/** Lenient on purpose: a hand-edited link with a bad value just loses that value. */
export function parseFilters(p: URLSearchParams): JournalFilters {
  const f: JournalFilters = {
    ...EMPTY_FILTERS,
    counterpartyIds: idList(p.get('cp')),
    categoryIds: idList(p.get('cat')),
    tagIds: idList(p.get('tg')),
    excludedOnly: p.get('ex') === '1',
  }
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
  f.types = typeList(p.get('types'))
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
  if (f.tagIds.length) p.set('tg', f.tagIds.join(','))
  if (f.excludedOnly) p.set('ex', '1')
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
    f.categoryIds.length > 0 ||
    f.tagIds.length > 0 ||
    f.excludedOnly
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

/** What the choice filters read from an operation: the journal's ledger rows and the reports' operations (S10f) both have it. */
export type SelectionFacts = Pick<LedgerTransaction, 'type' | 'accountId' | 'toAccountId' | 'categoryId' | 'counterpartyId' | 'tags'>

/** The choice part of a filter, one definition for the journal and the reports (S10f). */
export interface Selection {
  types: readonly TxType[]
  categoryIds: readonly string[]
  counterpartyIds: readonly string[]
  /** The operation's account, or the target account of a transfer, is one of these. */
  accountIds: readonly string[]
  /** Any of these tags; `NO_TAG` matches an operation without tags. */
  tagIds: readonly string[]
}

/**
 * Every non-empty list must match, and inside a list any value does: types and categories therefore work together (an
 * operation must fit both when both are chosen); counterparties, accounts and tags mean «any of the chosen».
 */
export function matchesSelection(tx: SelectionFacts, s: Selection): boolean {
  if (s.types.length && !s.types.includes(tx.type)) return false
  if (s.categoryIds.length && (tx.categoryId === undefined || !s.categoryIds.includes(tx.categoryId))) return false
  if (s.counterpartyIds.length && (tx.counterpartyId === undefined || !s.counterpartyIds.includes(tx.counterpartyId))) return false
  if (s.accountIds.length && !s.accountIds.includes(tx.accountId) && (tx.toAccountId === undefined || !s.accountIds.includes(tx.toAccountId))) return false
  if (s.tagIds.length) {
    const untagged = tx.tags.length === 0 && s.tagIds.includes(NO_TAG)
    if (!untagged && !tx.tags.some((id) => s.tagIds.includes(id))) return false
  }
  return true
}

/** The whole predicate, so the in-memory part of a page read and the tests use one definition. */
export function matchesFilters(tx: LedgerTransaction, f: JournalFilters, ctx: FilterContext): boolean {
  if (!matchesSelection(tx, { ...f, accountIds: f.accountId ? [f.accountId] : [] })) return false
  if (f.status && tx.status !== f.status) return false
  if (f.minMinor !== undefined && tx.amountMinor < f.minMinor) return false
  if (f.maxMinor !== undefined && tx.amountMinor > f.maxMinor) return false
  if (f.excludedOnly && tx.excluded !== true) return false

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
