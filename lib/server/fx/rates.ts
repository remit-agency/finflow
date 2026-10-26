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
