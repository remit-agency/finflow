import type { StepStatement } from '@/lib/domain/import/request'
import type { ImportOp } from '@/lib/domain/import/types'
import { IMPORT_STEP } from '@/lib/domain/import/types'
import type { ImportStepResult, ImportView, PreviewResult, UndoResult } from '@/lib/domain/import/view'
import { notifyLedgerChanged } from './ledger-events'
import { LedgerApiError, readApiError } from './ledger-client'

/** An undo removes 25 operations a step; this is only a stop against a runaway loop. */
const MAX_UNDO_STEPS = 400

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/imports`

export interface ImportStatementArgs {
  /** Set when a previous call of the same statement stopped early (busy or a failed step): the steps continue it. */
  importId?: string
  fileName: string
  accountId: string
  statement: StepStatement
  operations: ImportOp[]
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface ImportStatementResult {
  /** Null only when the first step was refused as busy, so no import exists yet. */
  importId: string | null
  created: number
  skipped: { seen: number; bank: number }
  refused: ImportStepResult['refused']
  /** From the last step; false when the statement did not finish (busy). */
  fitted: boolean
  balanceMinor: number | null
  closingMinor: number | null
  differenceMinor: number | null
  /** Another request is already writing this account: call again with the returned importId to continue. */
  busy: boolean
}

export interface UndoArgs {
  onProgress?: (deleted: number) => void
  signal?: AbortSignal
}

export interface UndoTotals {
  deleted: number
  kept: UndoResult['kept']
}

/** The operations split into steps of IMPORT_STEP; an empty list is one empty step, so the last step still runs. */
function stepsOf(operations: ImportOp[]): ImportOp[][] {
  const steps: ImportOp[][] = []
  for (let i = 0; i < operations.length; i += IMPORT_STEP) steps.push(operations.slice(i, i + IMPORT_STEP))
  return steps.length === 0 ? [[]] : steps
}

/** Reads a statement file without writing anything. */
export async function previewImport(orgId: string, body: { fileName: string; text: string; accountIds?: Array<string | null> }, signal?: AbortSignal): Promise<PreviewResult> {
  const res = await fetch(`${base(orgId)}/preview`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as PreviewResult
}

export async function listImports(orgId: string, signal?: AbortSignal): Promise<ImportView[]> {
  const res = await fetch(base(orgId), { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return ((await res.json()) as { imports: ImportView[] }).imports
}

/**
 * Writes one statement to one account, in steps of IMPORT_STEP operations, each carrying the importId of the one before.
 * A busy account (409 `already_running`) stops the loop with `busy: true`. Errors are thrown as `LedgerApiError`.
 * The journal is told once at the end, also after an error, since the steps before it may have written operations.
 */
export async function importStatement(orgId: string, args: ImportStatementArgs): Promise<ImportStatementResult> {
  const steps = stepsOf(args.operations)
  const total: ImportStatementResult = {
    importId: args.importId ?? null,
    created: 0,
    skipped: { seen: 0, bank: 0 },
    refused: [],
    fitted: false,
    balanceMinor: null,
    closingMinor: null,
    differenceMinor: null,
    busy: false,
  }
  let sent = 0
  try {
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1
      const body = {
        ...(total.importId === null ? {} : { importId: total.importId }),
        fileName: args.fileName,
        accountId: args.accountId,
        statement: args.statement,
        operations: steps[i],
        last,
      }
      const res = await fetch(base(orgId), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: args.signal,
      })
      if (!res.ok) {
        const error = await readApiError(res)
        if (error.code === 'already_running') {
          total.busy = true
          break
        }
        throw error
      }
      const step = (await res.json()) as ImportStepResult
      total.importId = step.importId
      total.created += step.created
      total.skipped.seen += step.skipped.seen
      total.skipped.bank += step.skipped.bank
      total.refused.push(...step.refused)
      if (last) {
        total.fitted = step.fitted
        total.balanceMinor = step.balanceMinor
        total.closingMinor = step.closingMinor
        total.differenceMinor = step.differenceMinor
      }
      sent += steps[i].length
      args.onProgress?.(sent, args.operations.length)
    }
  } finally {
    notifyLedgerChanged()
  }
  return total
}

/**
 * Removes every operation of an import that is still untouched, one page of the server's undo per request, until the server
 * says `done`. A runaway (more than MAX_UNDO_STEPS pages) is reported as an error: a partial undo must not look complete.
 */
export async function undoImport(orgId: string, importId: string, args: UndoArgs = {}): Promise<UndoTotals> {
  const totals: UndoTotals = { deleted: 0, kept: [] }
  let cursor: string | undefined
  try {
    for (let step = 0; step < MAX_UNDO_STEPS; step++) {
      const res = await fetch(`${base(orgId)}/${encodeURIComponent(importId)}/undo`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cursor === undefined ? {} : { cursor }),
        signal: args.signal,
      })
      if (!res.ok) throw await readApiError(res)
      const page = (await res.json()) as UndoResult
      totals.deleted += page.deleted
      totals.kept.push(...page.kept)
      args.onProgress?.(totals.deleted)
      if (page.done) return totals
      cursor = page.next ?? undefined
    }
    throw new LedgerApiError(0, 'undo_incomplete', { deleted: totals.deleted })
  } finally {
    notifyLedgerChanged()
  }
}
