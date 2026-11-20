import { MAX_COUNTERPARTIES } from '@/lib/domain/counterparties/types'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { LEDGER_CURRENCIES, type AccountType } from '@/lib/domain/ledger/types'
import { MAX_TAGS } from '@/lib/domain/tags/types'
import { normKey } from './fold'
import { SETUP_LIMITS, type FinmapSetupAccount } from './request'
import { MAX_FINMAP_BYTES, type ColumnKey, type FinmapPlan } from './types'

/** The company's counts of the two entities with a cap of their own (archived items included: the ledger counts them too). */
export interface CompanyCounts {
  tags: number
  counterparties: number
}

/** The entity whose company cap the plan would go over. */
export type CompanyLimit = 'tags' | 'counterparties'

/**
 * The Finmap import dialog as a pure state machine (S14b, no React, no I/O). The component reads the file, plans it and asks the
 * server; it dispatches the answers as events. Plans are derived in the event handlers and stored here, never in an effect.
 *
 *   idle|choosing|done|error --fileChosen--> reading --tableRead--> planning --planned--> choosing
 *   reading|planning|running --failed--> error
 *   choosing --optionChanged|accountChanged--> planning --planned--> choosing
 *   choosing --runStarted (canRun)--> running --progress*--> finished --> done | error (busy, or an error code)
 *   error --runStarted (canRetry: the import made so far continues)--> running
 */
export type FinmapPhase = 'idle' | 'reading' | 'planning' | 'choosing' | 'running' | 'done' | 'error'

export type FinmapErrorCode = 'unknown_layout' | 'empty' | 'too_many_rows' | 'not_xlsx' | 'too_big' | 'too_many_entities' | 'company_limit' | 'busy' | 'failed'

export interface FinmapError {
  code: FinmapErrorCode
  /** For `unknown_layout`: the column keys the file does not have. */
  missing?: ColumnKey[]
  /** For `company_limit`: the entity whose cap the company would exceed. */
  limit?: CompanyLimit
}

/** The part of a run's result the dialog reads. The client's result carries more (counts, refusals, entities). */
export interface FinmapRunResult {
  importId: string | null
  /** Another request is writing the same import or account: stopped, call again. */
  busy?: true
  /** The run stopped with this code (a ledger code, `network` or `aborted`). */
  error?: string
}

/** What the user chose for a new account. The currency defaults to the company's; the type to `bank`. */
export interface NewAccountSetting {
  type: AccountType
  currency: string
  /** The balance as typed: empty, or a decimal (see `parseBalanceText`). */
  balanceText: string
}

export interface FinmapDialogState<R extends FinmapRunResult = FinmapRunResult> {
  phase: FinmapPhase
  fileName: string | null
  companyCurrency: string
  /** Data rows the file has (after the header), once read. */
  rowsRead: number | null
  plan: FinmapPlan | null
  includePlanned: boolean
  pairTransfers: boolean
  /** The settings of the new accounts of the plan, by `normKey` of the account name. */
  accounts: ReadonlyMap<string, NewAccountSetting>
  /** The duplicate check of the plan: how many it has checked so far. */
  checking: { done: number; total: number } | null
  /** Operations of the plan an earlier import already wrote; null until a check has finished. */
  alreadyImported: number | null
  progress: { done: number; total: number } | null
  /** The import the run made (kept so that a retry continues it). */
  importId: string | null
  result: R | null
  error: FinmapError | null
}

export type FinmapEvent<R extends FinmapRunResult = FinmapRunResult> =
  | { type: 'fileChosen'; fileName: string; size: number }
  | { type: 'tableRead'; rowsRead: number }
  | { type: 'failed'; error: FinmapError }
  | { type: 'planned'; plan: FinmapPlan; have: CompanyCounts }
  | { type: 'optionChanged'; includePlanned?: boolean; pairTransfers?: boolean }
  | { type: 'accountChanged'; name: string; patch: Partial<NewAccountSetting> }
  | { type: 'checkProgress'; done: number; total: number }
  | { type: 'checked'; alreadyImported: number }
  | { type: 'checkStopped' }
  | { type: 'runStarted' }
  /** The set-up answered: the import exists from now on, whatever happens to the run after it. */
  | { type: 'importIdKnown'; importId: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'finished'; result: R }
  | { type: 'reset' }

const BUSY: ReadonlySet<FinmapPhase> = new Set<FinmapPhase>(['reading', 'planning', 'running'])

export function initialFinmapState<R extends FinmapRunResult = FinmapRunResult>(companyCurrency: string): FinmapDialogState<R> {
  return {
    phase: 'idle',
    fileName: null,
    companyCurrency,
    rowsRead: null,
    plan: null,
    includePlanned: true,
    pairTransfers: true,
    accounts: new Map(),
    checking: null,
    alreadyImported: null,
    progress: null,
    importId: null,
    result: null,
    error: null,
  }
}

/** The setting of a new account: what the user chose, or the defaults. */
export function accountSettingOf(state: FinmapDialogState<FinmapRunResult>, name: string): NewAccountSetting {
  return state.accounts.get(normKey(name)) ?? { type: 'bank', currency: state.companyCurrency, balanceText: '' }
}

/**
 * Currencies the user chose for new accounts, keyed by `normKey` of the name (the planner's option). Every chosen setting counts, so
 * a re-plan that drops a name from the file and brings it back keeps its currency; an account without a choice takes the planner's default.
 */
export function newAccountCurrencies(state: FinmapDialogState<FinmapRunResult>): Record<string, string> {
  // A null prototype: an account named like an Object property must not read one.
  const out: Record<string, string> = Object.create(null)
  for (const [key, setting] of state.accounts) out[key] = setting.currency
  return out
}

/** The new accounts the run creates, with the balances typed for them (a balance that is not valid is null: `canRun` refuses it). */
export function setupAccounts(state: FinmapDialogState<FinmapRunResult>): FinmapSetupAccount[] {
  return (state.plan?.create.accounts ?? []).map((name) => {
    const setting = accountSettingOf(state, name)
    const balance = parseBalanceText(setting.balanceText, setting.currency)
    return { name, type: setting.type, currency: setting.currency, currentBalanceMinor: balance.ok ? balance.minor : null }
  })
}

/** Whether the plan asks for more entities than one setup request may name (`SETUP_LIMITS`). */
export function entitiesOverLimit(plan: FinmapPlan): boolean {
  const c = plan.create
  return (
    c.accounts.length > SETUP_LIMITS.accounts ||
    c.categories.length > SETUP_LIMITS.categories ||
    c.counterparties.length > SETUP_LIMITS.counterparties ||
    c.tags.length > SETUP_LIMITS.tags
  )
}

/**
 * The company cap the plan would go over, tags first, or null. The setup creates what the plan lacks: a company holds at most
 * MAX_TAGS tags and MAX_COUNTERPARTIES counterparties, archived ones included, so the plan must fit into what is left.
 */
export function companyLimitOf(plan: FinmapPlan, have: CompanyCounts): CompanyLimit | null {
  if (have.tags + plan.create.tags.length > MAX_TAGS) return 'tags'
  if (have.counterparties + plan.create.counterparties.length > MAX_COUNTERPARTIES) return 'counterparties'
  return null
}

/** A balance as typed: `{ok: true, minor: null}` for empty, `{ok: true, minor}` for a decimal, `{ok: false}` otherwise. */
export type BalanceParse = { ok: true; minor: number | null } | { ok: false }

/**
 * A typed balance in minor units: an optional sign, digits, and at most two decimals after a `,` or a `.`. Spaces (also no-break
 * ones) are ignored, so `1 234,50` is a balance. Empty text is no balance. The currency must be one the ledger keeps.
 */
export function parseBalanceText(text: string, currency: string): BalanceParse {
  if (!(LEDGER_CURRENCIES as readonly string[]).includes(currency)) return { ok: false }
  const compact = text.replace(/[\s ]/g, '')
  if (compact === '') return { ok: true, minor: null }
  const m = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/.exec(compact)
  if (!m) return { ok: false }
  const whole = Number(m[2])
  const fraction = Number((m[3] ?? '').padEnd(2, '0'))
  const magnitude = whole * 100 + fraction
  if (!Number.isSafeInteger(magnitude) || magnitude > MAX_MINOR) return { ok: false }
  return { ok: true, minor: m[1] === '-' && magnitude !== 0 ? -magnitude : magnitude }
}

/** The run is possible: a plan with at least one operation, no limit exceeded, and every new account's balance valid. */
export function canRun(state: FinmapDialogState<FinmapRunResult>): boolean {
  if (state.phase !== 'choosing' || state.error !== null || state.plan === null || state.plan.operations.length === 0) return false
  return state.plan.create.accounts.every((name) => {
    const setting = accountSettingOf(state, name)
    return parseBalanceText(setting.balanceText, setting.currency).ok
  })
}

/**
 * A stopped run can continue the import it made: the same plan, sent again with the import's id. A run that failed after its
 * set-up answered has the id (`importIdKnown`) even when it has no result; one that failed before has neither and starts again.
 */
export function canRetry(state: FinmapDialogState<FinmapRunResult>): boolean {
  return state.phase === 'error' && state.plan !== null && (state.result !== null || state.importId !== null)
}

export function finmapDialogReducer<R extends FinmapRunResult>(state: FinmapDialogState<R>, event: FinmapEvent<R>): FinmapDialogState<R> {
  switch (event.type) {
    case 'fileChosen': {
      if (BUSY.has(state.phase)) return state
      const fresh: FinmapDialogState<R> = { ...initialFinmapState<R>(state.companyCurrency), fileName: event.fileName }
      if (event.size > MAX_FINMAP_BYTES) return { ...fresh, phase: 'error', error: { code: 'too_big' } }
      return { ...fresh, phase: 'reading' }
    }
    case 'tableRead':
      return state.phase === 'reading' ? { ...state, phase: 'planning', rowsRead: event.rowsRead } : state
    case 'failed':
      if (!BUSY.has(state.phase)) return state
      return { ...state, phase: 'error', error: event.error, progress: null, checking: null }
    case 'planned': {
      if (state.phase !== 'planning') return state
      const limit = companyLimitOf(event.plan, event.have)
      const error: FinmapError | null = entitiesOverLimit(event.plan)
        ? { code: 'too_many_entities' }
        : limit === null
          ? null
          : { code: 'company_limit', limit }
      return { ...state, phase: 'choosing', plan: event.plan, checking: null, alreadyImported: null, error }
    }
    case 'optionChanged':
      if (state.phase !== 'choosing') return state
      return {
        ...state,
        phase: 'planning',
        includePlanned: event.includePlanned ?? state.includePlanned,
        pairTransfers: event.pairTransfers ?? state.pairTransfers,
        checking: null,
        alreadyImported: null,
        error: null,
      }
    case 'accountChanged': {
      if (state.phase !== 'choosing') return state
      const before = accountSettingOf(state, event.name)
      const after = { ...before, ...event.patch }
      const accounts = new Map(state.accounts)
      accounts.set(normKey(event.name), after)
      // Only the currency takes part in the plan (transfer pairing reads it): a type or a balance is stored without planning again.
      if (after.currency === before.currency) return { ...state, accounts }
      return { ...state, phase: 'planning', accounts, checking: null, alreadyImported: null, error: null }
    }
    case 'checkProgress':
      return state.phase === 'choosing' ? { ...state, checking: { done: event.done, total: event.total } } : state
    case 'checked':
      return state.phase === 'choosing' ? { ...state, checking: null, alreadyImported: event.alreadyImported } : state
    case 'checkStopped':
      return state.phase === 'choosing' ? { ...state, checking: null } : state
    case 'runStarted': {
      if (!canRun(state) && !canRetry(state)) return state
      return {
        ...state,
        phase: 'running',
        progress: { done: 0, total: state.plan?.operations.length ?? 0 },
        result: null,
        error: null,
      }
    }
    case 'importIdKnown':
      return state.phase === 'running' ? { ...state, importId: event.importId } : state
    case 'progress':
      return state.phase === 'running' ? { ...state, progress: { done: event.done, total: event.total } } : state
    case 'finished': {
      if (state.phase !== 'running') return state
      const busy = event.result.busy === true
      const failed = busy || event.result.error !== undefined
      return {
        ...state,
        phase: failed ? 'error' : 'done',
        result: event.result,
        importId: event.result.importId ?? state.importId,
        progress: null,
        error: failed ? { code: busy ? 'busy' : 'failed' } : null,
      }
    }
    case 'reset':
      return initialFinmapState<R>(state.companyCurrency)
  }
}
