import { ordinalsByAccount } from './identity'
import type { StepStatement } from './request'
import { MAX_IMPORT_BYTES, type ImportOp, type RefusalReason } from './types'
import type { PreviewResult, PreviewStatement } from './view'

/**
 * The import dialog as a pure state machine (no React, no I/O): the component reads a file, asks the server and dispatches
 * the answers as events. The phases that wait on the server (`reading`, `previewing`, `counting`, `running`) take no user input.
 *
 *   idle|choosing|done|error --pick--> reading --decoded--> previewing --previewed--> counting|choosing
 *   counting --counted--> choosing --choose (other accounts)--> counting ...
 *   choosing --run (canRun)--> running --outcome*, progress*--> done | error (failed)
 */
export type DialogPhase = 'idle' | 'reading' | 'previewing' | 'choosing' | 'counting' | 'running' | 'done' | 'error'

export type DialogErrorCode = 'too_big' | 'not_mt940' | 'too_many' | 'busy' | 'failed'

export interface DialogError {
  code: DialogErrorCode
  /** `not_mt940`: the line of the first issue of the file, when it gives one. */
  line: number | null
}

/** What the write of one statement came to. */
export interface StatementOutcome {
  /** Position of the statement in the file. */
  index: number
  accountId: string
  created: number
  skipped: { seen: number; bank: number }
  refused: RefusalReason[]
  fitted: boolean
  differenceMinor: number | null
  /** The account was busy: the statement was not written and the run stopped here. */
  busy: boolean
}

export interface DialogState {
  phase: DialogPhase
  fileName: string | null
  /** The decoded file text: a count or a run after a choice sends it again. */
  text: string | null
  preview: PreviewResult | null
  /** Per statement (same order as `preview.statements`): the chosen FinFlow account, null = skip. */
  accounts: Array<string | null>
  /** The accounts `preview` was counted for; null until a count has run. */
  countedFor: Array<string | null> | null
  /** Operations sent so far of all operations of the run. */
  progress: { done: number; total: number } | null
  outcomes: StatementOutcome[]
  error: DialogError | null
}

export const initialDialogState: DialogState = {
  phase: 'idle',
  fileName: null,
  text: null,
  preview: null,
  accounts: [],
  countedFor: null,
  progress: null,
  outcomes: [],
  error: null,
}

export type DialogEvent =
  | { type: 'pick'; fileName: string; size: number }
  | { type: 'decoded'; text: string }
  | { type: 'previewed'; preview: PreviewResult }
  | { type: 'choose'; index: number; accountId: string | null }
  | { type: 'counted'; preview: PreviewResult; accounts: Array<string | null> }
  | { type: 'run' }
  | { type: 'progress'; done: number }
  | { type: 'outcome'; outcome: StatementOutcome }
  | { type: 'finished' }
  | { type: 'failed'; error: DialogError }

/** One statement of the run: what the write step gets. Only statements with a chosen account take part. */
export interface RunItem {
  index: number
  accountId: string
  statement: StepStatement
  operations: ImportOp[]
}

export function withAccount(accounts: ReadonlyArray<string | null>, index: number, accountId: string | null): Array<string | null> {
  return accounts.map((current, i) => (i === index ? accountId : current))
}

/** True when `accounts` differ from the ones `countedFor` was counted with (or nothing was counted yet). */
export function needsCount(countedFor: ReadonlyArray<string | null> | null, accounts: ReadonlyArray<string | null>): boolean {
  return countedFor === null || countedFor.length !== accounts.length || countedFor.some((account, i) => account !== accounts[i])
}

/**
 * A statement is complete when it parsed with no issue, its lines add up to the closing balance, and at least one of its lines
 * is not refused (a statement whose lines are all refused, or that has none, is never complete: it cannot fit a balance).
 */
export function isComplete(statement: PreviewStatement): boolean {
  return statement.issues.length === 0 && statement.reconciliation === 0 && statement.operations.some((op) => op.status !== undefined && !op.status.startsWith('refused:'))
}

/**
 * The statements the run writes, in file order. A statement with a chosen account is kept even when it has no new operation:
 * its last step still fits the balance. The ordinals are those of `ordinalsByAccount`: the same numbering the preview showed.
 * Nothing is planned before the counting (`countedFor` is null).
 */
export function runPlan(state: DialogState): RunItem[] {
  if (state.preview === null || state.countedFor === null) return []
  const chosen: Array<{ index: number; accountId: string; statement: PreviewStatement }> = []
  state.preview.statements.forEach((statement, index) => {
    const accountId = state.accounts[index] ?? null
    if (accountId !== null) chosen.push({ index, accountId, statement })
  })
  const ordinals = ordinalsByAccount(chosen.map(({ accountId, statement }) => ({ accountId, ops: statement.operations })))
  return chosen.map(({ index, accountId, statement }, i) => ({
    index,
    accountId,
    statement: {
      source: statement.source,
      currency: statement.currency,
      from: statement.from,
      to: statement.to,
      closingMinor: statement.closing?.amountMinor ?? null,
      complete: isComplete(statement),
    },
    operations: statement.operations.flatMap((op, j) =>
      op.status === 'new'
        ? [{ day: op.day, type: op.type, amountMinor: op.amountMinor, reference: op.reference, counterpartyName: op.counterpartyName, remittance: op.remittance, ordinal: ordinals[i][j] }]
        : [],
    ),
  }))
}

/** The run is possible once the accounts are counted and at least one operation is new. */
export function canRun(state: DialogState): boolean {
  return state.phase === 'choosing' && runPlan(state).some((item) => item.operations.length > 0)
}

function totalOperations(items: RunItem[]): number {
  return items.reduce((n, item) => n + item.operations.length, 0)
}

/** Phases that wait on the server: no user input, and their failure is an error. */
export function isBusy(phase: DialogPhase): boolean {
  return phase === 'reading' || phase === 'previewing' || phase === 'counting' || phase === 'running'
}

export function importDialogReducer(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'pick': {
      if (isBusy(state.phase)) return state
      if (event.size > MAX_IMPORT_BYTES) return { ...initialDialogState, fileName: event.fileName, phase: 'error', error: { code: 'too_big', line: null } }
      return { ...initialDialogState, phase: 'reading', fileName: event.fileName }
    }
    case 'decoded':
      return state.phase === 'reading' ? { ...state, phase: 'previewing', text: event.text } : state
    case 'previewed': {
      if (state.phase !== 'previewing') return state
      if (event.preview.statements.length === 0) {
        return { ...state, phase: 'error', error: { code: 'not_mt940', line: event.preview.issues[0]?.line ?? null } }
      }
      const accounts = event.preview.statements.map((statement) => statement.suggestedAccountId)
      const suggested = accounts.some((account) => account !== null)
      return { ...state, phase: suggested ? 'counting' : 'choosing', preview: event.preview, accounts, countedFor: null }
    }
    case 'choose': {
      if (state.phase !== 'choosing' || state.preview === null) return state
      const accounts = withAccount(state.accounts, event.index, event.accountId)
      return { ...state, accounts, phase: needsCount(state.countedFor, accounts) ? 'counting' : 'choosing', error: null }
    }
    case 'counted':
      if (state.phase !== 'counting') return state
      return { ...state, phase: 'choosing', preview: event.preview, accounts: event.accounts, countedFor: event.accounts }
    case 'run': {
      if (!canRun(state)) return state
      return { ...state, phase: 'running', progress: { done: 0, total: totalOperations(runPlan(state)) }, outcomes: [], error: null }
    }
    case 'progress':
      return state.phase === 'running' && state.progress !== null ? { ...state, progress: { ...state.progress, done: event.done } } : state
    case 'outcome':
      return state.phase === 'running' ? { ...state, outcomes: [...state.outcomes, event.outcome] } : state
    case 'finished':
      return state.phase === 'running' ? { ...state, phase: 'done', progress: null } : state
    case 'failed':
      if (!isBusy(state.phase)) return state
      return { ...state, phase: 'error', progress: null, error: event.error }
  }
}
