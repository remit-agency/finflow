import { revertTransaction, restoreTransaction } from '@/lib/api/transaction-undo'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import type { BulkOutcome } from '@/lib/domain/journal/bulk-input'
import { splitByPatch, type BulkPatch, type SkipReason } from '@/lib/domain/journal/selection'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { applyBulk, type ChunkedResult } from './journal-bulk'

type Send = (action: 'update' | 'delete', ids: string[], patch?: BulkPatch) => Promise<BulkOutcome[]>

export interface BulkReport {
  /** Rows the server changed (or deleted), as they were before: what an undo has to put back. */
  applied: LedgerTransaction[]
  failed: { id: string; code: string }[]
  skipped: { id: string; reason: SkipReason }[]
  stopped: boolean
}

interface Options {
  orgId?: string
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  /** For tests: replaces the network. */
  send?: Send
}

function report(rows: LedgerTransaction[], outcomes: BulkOutcome[], skipped: BulkReport['skipped'], stopped: boolean): BulkReport {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const applied: LedgerTransaction[] = []
  const failed: BulkReport['failed'] = []
  for (const o of outcomes) {
    if (o.ok) applied.push(byId.get(o.id) as LedgerTransaction)
    else failed.push({ id: o.id, code: o.code })
  }
  return { applied, failed, skipped, stopped }
}

async function run(action: 'update' | 'delete', ids: string[], patch: BulkPatch | undefined, o: Options): Promise<ChunkedResult> {
  // The injected sender is called once with everything: chunking has its own test.
  if (o.send) return { outcomes: await o.send(action, ids, patch), stopped: false }
  return applyBulk(o.orgId as string, action, ids, patch, { signal: o.signal, onProgress: o.onProgress })
}

/** Applies `patch` to the selection (rows it cannot apply to are skipped before anything is sent). */
export async function bulkChange(rows: LedgerTransaction[], patch: BulkPatch, o: Options & { today: string }): Promise<BulkReport> {
  const { apply, skipped } = splitByPatch(rows, patch, o.today)
  const { outcomes, stopped } = await run('update', apply.map((r) => r.id), patch, o)
  return report(apply, outcomes, skipped, stopped)
}

export async function bulkDelete(rows: LedgerTransaction[], o: Options): Promise<BulkReport> {
  const { outcomes, stopped } = await run('delete', rows.map((r) => r.id), undefined, o)
  return report(rows, outcomes, [], stopped)
}

interface UndoResult {
  done: number
  failed: number
}

async function each(rows: LedgerTransaction[], step: (row: LedgerTransaction) => Promise<unknown>): Promise<UndoResult> {
  let done = 0
  let failed = 0
  for (const row of rows) {
    try {
      await step(row)
      done++
    } catch {
      failed++
    }
  }
  return { done, failed }
}

/** Writes the rows back as they were before a bulk change (a full replace each, as the single-edit undo does). */
export function undoBulkChange(
  before: LedgerTransaction[],
  o: { orgId?: string; revert?: (row: LedgerTransaction) => Promise<unknown> } = {},
): Promise<UndoResult> {
  const revert = o.revert ?? ((row: LedgerTransaction) => revertTransaction(o.orgId as string, toUiTransaction(o.orgId as string, row)))
  return each(before, revert)
}

/** Creates deleted rows again under their own ids. */
export function undoBulkDelete(
  rows: LedgerTransaction[],
  o: { orgId?: string; restore?: (row: LedgerTransaction) => Promise<unknown> } = {},
): Promise<UndoResult> {
  const restore = o.restore ?? ((row: LedgerTransaction) => restoreTransaction(o.orgId as string, toUiTransaction(o.orgId as string, row)))
  return each(rows, restore)
}
