import { FxError, type NbpTable } from '@/lib/server/fx/types'

const CODE = /^[A-Z]{3}$/

/** ISO 4217 shape only (three uppercase letters); whether NBP lists it is the resolver's call. */
export function isCurrencyCode(s: unknown): s is string {
  return typeof s === 'string' && CODE.test(s)
}

/** Rates are stored and returned with 8 decimals (as Finmap shows them). */
export function round8(x: number): number {
  return Number(x.toFixed(8))
}

/**
 * The table with the greatest effectiveDate strictly before `day` (NBP rule: the last working day
 * BEFORE the operation). `tables` must be ascending. Weekends and holidays need no calendar: no
 * table is published on them.
 */
export function pickTable(tables: readonly NbpTable[], day: string): NbpTable | null {
  for (let i = tables.length - 1; i >= 0; i--) {
    if (tables[i].effectiveDate < day) return tables[i]
  }
  return null
}

function mid(table: NbpTable, code: string): number {
  if (code === 'PLN') return 1
  if (!Object.hasOwn(table.rates, code)) throw new FxError('unsupported_currency')
  return table.rates[code]
}

/** Unrounded rate converting one unit of `from` into `to` through PLN. */
export function crossRate(table: NbpTable, from: string, to: string): number {
  return mid(table, from) / mid(table, to)
}

const TABLE_NO = /^(\d+)\/A\/NBP\/(\d{4})$/

/**
 * Checks a freshly fetched month before it replaces the cached one, so a worse NBP reply never
 * overwrites a good document. Throws `provider_unavailable` when the reply (a) lost a day the cache
 * already holds, (b) is empty for a finished month, or (c) skips a table number inside one year
 * (an unparsable `no` is ignored). `newTables` must be ascending.
 */
export function validateRefresh(
  newTables: readonly NbpTable[],
  cachedTables: readonly NbpTable[],
  finished: boolean,
): void {
  const days = new Set(newTables.map((t) => t.effectiveDate))
  if (cachedTables.some((t) => !days.has(t.effectiveDate))) throw new FxError('provider_unavailable')
  if (finished && newTables.length === 0) throw new FxError('provider_unavailable')
  for (let i = 1; i < newTables.length; i++) {
    const prev = TABLE_NO.exec(newTables[i - 1].no)
    const next = TABLE_NO.exec(newTables[i].no)
    if (prev && next && prev[2] === next[2] && Number(next[1]) !== Number(prev[1]) + 1) {
      throw new FxError('provider_unavailable')
    }
  }
}
