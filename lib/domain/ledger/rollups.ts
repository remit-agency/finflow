import { monthOf } from './days'
import { baseOf } from './build'
import { allocatePeriod } from './period'
import type { LedgerTransaction } from './types'

export const NO_CATEGORY = '_none'

/** One rollup document as flat dotted fields, e.g. `inMinor` or `categories.<id>.incomeBase`. */
export type RollupFlat = Record<string, number>
/** Rollup documents by id. A document or field whose value is 0 is simply absent. */
export type RollupDocs = Map<string, RollupFlat>

export const cashDocId = (accountId: string, day: string) => `cash_${accountId}_${day}`
export const cashCatDocId = (month: string) => `cashcat_${month}`
export const plDocId = (month: string) => `pl_${month}`

function bump(docs: RollupDocs, id: string, field: string, delta: number): void {
  if (delta === 0) return
  const flat = docs.get(id) ?? {}
  const next = (flat[field] ?? 0) + delta
  if (next === 0) delete flat[field]
  else flat[field] = next
  if (Object.keys(flat).length === 0) docs.delete(id)
  else docs.set(id, flat)
}

/** Adds `source` into `target`; entries that reach 0 disappear. */
export function addInto(target: RollupDocs, source: RollupDocs): void {
  for (const [id, flat] of source) {
    for (const [field, delta] of Object.entries(flat)) bump(target, id, field, delta)
  }
}

/**
 * What one operation adds to the rollups (times `sign`):
 *  - cash_{account}_{paymentDay}: in/out in the account currency and in the company currency; transfer in/out;
 *  - cashcat_{paymentMonth}: per category, company currency;
 *  - pl_{accrualMonth}: per category, company currency, a period spread over its months.
 * Planned operations contribute nothing. Throws when an operation in another currency has no base amounts.
 */
export function contributions(tx: LedgerTransaction, baseCurrency: string, sign: 1 | -1 = 1): RollupDocs {
  const docs: RollupDocs = new Map()
  if (tx.status !== 'actual') return docs

  if (tx.type === 'transfer') {
    bump(docs, cashDocId(tx.accountId, tx.paymentDate), 'transferOutMinor', sign * tx.amountMinor)
    bump(docs, cashDocId(tx.toAccountId as string, tx.paymentDate), 'transferInMinor', sign * (tx.toAmountMinor as number))
    return docs
  }

  const base = baseOf(tx, baseCurrency)
  if (!base) throw new Error(`operation ${tx.id} has no base amounts`)
  const income = tx.type === 'income'
  const category = tx.categoryId ?? NO_CATEGORY
  const field = `categories.${category}.${income ? 'incomeBase' : 'expenseBase'}`

  const cash = cashDocId(tx.accountId, tx.paymentDate)
  bump(docs, cash, income ? 'inMinor' : 'outMinor', sign * tx.amountMinor)
  bump(docs, cash, income ? 'inBase' : 'outBase', sign * base.payment)
  bump(docs, cashCatDocId(monthOf(tx.paymentDate)), field, sign * base.payment)

  const parts: Array<[string, number]> =
    tx.accrual.mode === 'date'
      ? [[monthOf(tx.accrual.date), base.accrual]]
      : allocatePeriod(base.accrual, tx.accrual.from, tx.accrual.to)
  for (const [month, value] of parts) bump(docs, plDocId(month), field, sign * value)
  return docs
}

/** Dotted flat fields to a nested object; `leaf` wraps each number (e.g. FieldValue.increment). */
export function nest(flat: RollupFlat, leaf: (n: number) => unknown = (n) => n): Record<string, unknown> {
  // Keys are user data (category ids): only own properties count, and a node is defined, never assigned, so ids such as
  // `constructor` or `toString` are ordinary keys and nothing reaches Object.prototype.
  const setOwn = (target: Record<string, unknown>, key: string, value: unknown) =>
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  const out: Record<string, unknown> = {}
  for (const [path, n] of Object.entries(flat)) {
    const keys = path.split('.')
    let cursor = out
    for (const key of keys.slice(0, -1)) {
      if (!Object.hasOwn(cursor, key)) setOwn(cursor, key, {})
      cursor = cursor[key] as Record<string, unknown>
    }
    setOwn(cursor, keys[keys.length - 1], leaf(n))
  }
  return out
}

/** The inverse of `nest` for stored documents; non-number leaves are ignored. */
export function flatten(nested: unknown, prefix = ''): RollupFlat {
  const out: RollupFlat = {}
  if (typeof nested !== 'object' || nested === null) return out
  for (const [key, value] of Object.entries(nested)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'number') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

export interface RollupDiff {
  docId: string
  field: string
  stored: number
  expected: number
}

/** Differences between two rollup sets; a missing document or field counts as 0. Sorted by doc, field. */
export function diffRollups(stored: RollupDocs, expected: RollupDocs): RollupDiff[] {
  const diffs: RollupDiff[] = []
  const ids = [...new Set([...stored.keys(), ...expected.keys()])].sort()
  for (const docId of ids) {
    const a = stored.get(docId) ?? {}
    const b = expected.get(docId) ?? {}
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const s = a[field] ?? 0
      const e = b[field] ?? 0
      if (s !== e) diffs.push({ docId, field, stored: s, expected: e })
    }
  }
  return diffs
}
