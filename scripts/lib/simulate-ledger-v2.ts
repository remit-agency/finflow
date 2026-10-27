// Dry-run check for the schema 1 -> schema 2 migration (S05): builds the rollups the final rebuild will write and
// reports what would make that fail, before anything is written. Pure: unit-tested in Vitest.
import { baseOf } from '@/lib/domain/ledger/build'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { isId } from '@/lib/domain/ledger/guards'
import { contributions, nest } from '@/lib/domain/ledger/rollups'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'

const RESERVED = /^__.*__$/

/** Firestore refuses empty and `__x__` field names. Only ids and a reason are reported, never document contents. */
function assertWritable(node: unknown): void {
  if (typeof node !== 'object' || node === null) return
  for (const [key, value] of Object.entries(node)) {
    if (key === '' || RESERVED.test(key)) throw new Error('a rollup field name Firestore refuses')
    assertWritable(value)
  }
}

export interface SimulationInput {
  baseCurrency: string
  /** Every account after the migration (already migrated and planned). */
  accounts: LedgerAccount[]
  /** Every operation after the migration (already migrated and planned). */
  txs: LedgerTransaction[]
}

/** null when the rollups can be built and written; otherwise a message naming the operation (ids only) or the failure. */
export function simulateRollups({ baseCurrency, accounts, txs }: SimulationInput): string | null {
  // Operation by operation first, so the message can name the one that breaks.
  for (const tx of txs) {
    // Not countable (no base amounts): the rebuild leaves it out, see below.
    if (tx.status === 'actual' && tx.type !== 'transfer' && baseOf(tx, baseCurrency) === null) continue
    if (tx.categoryId !== undefined && !isId(tx.categoryId)) return `operation ${tx.id}: its category id is not a valid id`
    try {
      for (const flat of contributions(tx, baseCurrency).values()) assertWritable(nest(flat))
    } catch (e) {
      return `operation ${tx.id}: ${e instanceof Error ? e.message : 'rollups cannot be built'}`
    }
  }
  // Then the whole ledger the way the rebuild computes it.
  try {
    // Operations that cannot be counted (`expected.invalid`) are not a failure: the rebuild leaves them out and verifyLedger lists them.
    const expected = computeLedger(accounts, txs, baseCurrency)
    for (const flat of expected.rollups.values()) assertWritable(nest(flat))
  } catch (e) {
    return `the rollups cannot be built: ${e instanceof Error ? e.message : 'error'}`
  }
  return null
}
