import { describe, expect, it } from 'vitest'
import { normKey as normKeyOf } from '@/lib/domain/import/finmap/fold'
import { SETUP_LIMITS } from '@/lib/domain/import/finmap/request'
import { MAX_FINMAP_BYTES, type FinmapCounts, type FinmapPlan, type PlannedOp } from '@/lib/domain/import/finmap/types'
import { MAX_COUNTERPARTIES } from '@/lib/domain/counterparties/types'
import { MAX_TAGS } from '@/lib/domain/tags/types'
import {
  accountSettingOf,
  canRun,
  companyLimitOf,
  entitiesOverLimit,
  finmapDialogReducer,
  initialFinmapState,
  newAccountCurrencies,
  parseBalanceText,
  setupAccounts,
  type FinmapDialogState,
  type FinmapEvent,
  type FinmapRunResult,
} from '@/lib/domain/import/finmap/state'

// Synthetic names only.
const COUNTS: FinmapCounts = {
  rows: 1,
  income: 0,
  expense: 1,
  transfer: 0,
  planned: 0,
  pairCandidatesLeft: 0,
  refused: {},
  warnings: { commentCut: 0, subcounterparty: 0, project: 0, accrualIgnored: 0, categoryIgnored: 0 },
}

const OP: PlannedOp = {
  kind: 'expense',
  status: 'actual',
  day: '2026-11-03',
  amountMinor: 1000,
  account: 'Konto Alfa',
  toAccount: null,
  toAmountMinor: null,
  category: null,
  counterparty: null,
  tags: [],
  description: null,
  accrual: null,
  identity: ['t1', '1000'],
  ordinal: 0,
  lines: [2],
}

function planWith(over: Partial<FinmapPlan> = {}): FinmapPlan {
  return {
    operations: [OP],
    period: { from: '2026-11-03', to: '2026-11-03' },
    create: { accounts: [], categories: [], counterparties: [], tags: [] },
    matched: { accounts: 1, categories: 0, counterparties: 0, tags: 0 },
    counts: COUNTS,
    ...over,
  }
}

const start = (companyCurrency = 'PLN') => initialFinmapState(companyCurrency)

function step<R extends FinmapRunResult = FinmapRunResult>(state: FinmapDialogState<R>, ...events: FinmapEvent<R>[]): FinmapDialogState<R> {
  return events.reduce((s, e) => finmapDialogReducer(s, e), state)
}

/** The company's counts of tags and counterparties when a test does not care about them (an empty company). */
const EMPTY_COMPANY = { tags: 0, counterparties: 0 }

/** A state in `choosing` with `plan` (a file read and planned). */
function choosing(plan: FinmapPlan = planWith(), companyCurrency = 'PLN'): FinmapDialogState {
  return step(start(companyCurrency), { type: 'fileChosen', fileName: 'x.xlsx', size: 10 }, { type: 'tableRead', rowsRead: 1 }, { type: 'planned', plan, have: EMPTY_COMPANY })
}

describe('initialFinmapState', () => {
  it('starts idle with the company currency and the default switches', () => {
    const s = start('EUR')
    expect(s.phase).toBe('idle')
    expect(s.companyCurrency).toBe('EUR')
    expect(s.plan).toBeNull()
    expect(s.result).toBeNull()
    expect(s.error).toBeNull()
    expect(s.includePlanned).toBe(true)
    expect(s.pairTransfers).toBe(true)
  })
})

describe('fileChosen', () => {
  it('starts reading and keeps the file name', () => {
    const s = step(start(), { type: 'fileChosen', fileName: 'platnosci.xlsx', size: 1000 })
    expect(s.phase).toBe('reading')
    expect(s.fileName).toBe('platnosci.xlsx')
  })

  it('refuses a file over the size cap without reading it', () => {
    const s = step(start(), { type: 'fileChosen', fileName: 'big.xlsx', size: MAX_FINMAP_BYTES + 1 })
    expect(s.phase).toBe('error')
    expect(s.error).toEqual({ code: 'too_big' })
  })

  it('accepts a file of exactly the cap', () => {
    expect(step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: MAX_FINMAP_BYTES }).phase).toBe('reading')
  })

  it('is ignored while a file is being read, planned or run', () => {
    const reading = step(start(), { type: 'fileChosen', fileName: 'a.xlsx', size: 1 })
    expect(finmapDialogReducer(reading, { type: 'fileChosen', fileName: 'b.xlsx', size: 1 })).toBe(reading)
    const planning = step(reading, { type: 'tableRead', rowsRead: 1 })
    expect(finmapDialogReducer(planning, { type: 'fileChosen', fileName: 'b.xlsx', size: 1 })).toBe(planning)
  })

  it('replaces a finished or failed run with a fresh file and drops its plan and result', () => {
    const done = step(choosing(), { type: 'runStarted' }, { type: 'finished', result: { importId: 'imp-1' } })
    const s = step(done, { type: 'fileChosen', fileName: 'new.xlsx', size: 1 })
    expect(s.phase).toBe('reading')
    expect(s.plan).toBeNull()
    expect(s.result).toBeNull()
    expect(s.importId).toBeNull()
    expect(s.companyCurrency).toBe('PLN')
  })
})

describe('tableRead', () => {
  it('moves from reading to planning and keeps the row count', () => {
    const s = step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: 1 }, { type: 'tableRead', rowsRead: 42 })
    expect(s.phase).toBe('planning')
    expect(s.rowsRead).toBe(42)
  })

  it('is ignored outside reading', () => {
    const s = start()
    expect(finmapDialogReducer(s, { type: 'tableRead', rowsRead: 1 })).toBe(s)
  })
})

describe('failed', () => {
  it('ends a read with its code and the missing columns', () => {
    const s = step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: 1 }, { type: 'failed', error: { code: 'unknown_layout', missing: ['from', 'to'] } })
    expect(s.phase).toBe('error')
    expect(s.error).toEqual({ code: 'unknown_layout', missing: ['from', 'to'] })
  })

  it.each(['not_xlsx', 'empty', 'too_many_rows'] as const)('ends a read with %s', (code) => {
    const s = step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: 1 }, { type: 'failed', error: { code } })
    expect(s.error).toEqual({ code })
  })

  it('ends a planning step', () => {
    const s = step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: 1 }, { type: 'tableRead', rowsRead: 1 }, { type: 'failed', error: { code: 'failed' } })
    expect(s.phase).toBe('error')
  })

  it('stops a run and keeps its plan', () => {
    const s = step(choosing(), { type: 'runStarted' }, { type: 'failed', error: { code: 'failed' } })
    expect(s.phase).toBe('error')
    expect(s.progress).toBeNull()
    expect(s.plan).not.toBeNull()
  })

  it('is ignored when nothing is in progress', () => {
    const s = start()
    expect(finmapDialogReducer(s, { type: 'failed', error: { code: 'failed' } })).toBe(s)
    const chosen = choosing()
    expect(finmapDialogReducer(chosen, { type: 'failed', error: { code: 'failed' } })).toBe(chosen)
  })
})

describe('planned', () => {
  it('moves from planning to choosing with the plan', () => {
    const plan = planWith()
    const s = choosing(plan)
    expect(s.phase).toBe('choosing')
    expect(s.plan).toBe(plan)
    expect(s.error).toBeNull()
  })

  it('is ignored outside planning', () => {
    const s = choosing()
    expect(finmapDialogReducer(s, { type: 'planned', plan: planWith(), have: EMPTY_COMPANY })).toBe(s)
  })

  it('blocks the run with company_limit when the company has no room for the tags or counterparties the file adds', () => {
    const plan = planWith({ create: { accounts: [], categories: [], counterparties: ['Dostawca A'], tags: ['Etykieta A', 'Etykieta B'] } })
    const s = step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: 10 }, { type: 'tableRead', rowsRead: 1 }, { type: 'planned', plan, have: { tags: MAX_TAGS - 1, counterparties: 0 } })
    expect(s.phase).toBe('choosing')
    expect(s.error).toEqual({ code: 'company_limit', limit: 'tags' })
    expect(canRun(s)).toBe(false)
    // Exactly at the cap is allowed: the two new tags fill the company up to MAX_TAGS.
    const room = step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: 10 }, { type: 'tableRead', rowsRead: 1 }, { type: 'planned', plan, have: { tags: MAX_TAGS - 2, counterparties: MAX_COUNTERPARTIES - 1 } })
    expect(room.error).toBeNull()
    expect(canRun(room)).toBe(true)
    // One counterparty over the company's cap, the tags fit.
    const counterparty = step(start(), { type: 'fileChosen', fileName: 'x.xlsx', size: 10 }, { type: 'tableRead', rowsRead: 1 }, { type: 'planned', plan, have: { tags: 0, counterparties: MAX_COUNTERPARTIES } })
    expect(counterparty.error).toEqual({ code: 'company_limit', limit: 'counterparties' })
  })

  it('keeps the plan but blocks the run when a limit of the setup is exceeded', () => {
    const accounts = Array.from({ length: SETUP_LIMITS.accounts + 1 }, (_, i) => `Konto ${i}`)
    const plan = planWith({ create: { accounts, categories: [], counterparties: [], tags: [] } })
    const s = choosing(plan)
    expect(s.phase).toBe('choosing')
    expect(s.error).toEqual({ code: 'too_many_entities' })
    expect(s.plan).toBe(plan)
    expect(canRun(s)).toBe(false)
  })

  it('clears a previous count when the plan changes', () => {
    const counted = step(choosing(), { type: 'checkProgress', done: 1, total: 2 }, { type: 'checked', alreadyImported: 1 })
    const s = step(counted, { type: 'optionChanged', includePlanned: true })
    const replanned = finmapDialogReducer(s, { type: 'planned', plan: planWith(), have: EMPTY_COMPANY })
    expect(replanned.alreadyImported).toBeNull()
    expect(replanned.checking).toBeNull()
  })
})

describe('optionChanged', () => {
  it('moves to planning with the new switch and keeps the plan until the new one arrives', () => {
    const plan = planWith()
    const s = finmapDialogReducer(choosing(plan), { type: 'optionChanged', pairTransfers: false })
    expect(s.phase).toBe('planning')
    expect(s.pairTransfers).toBe(false)
    expect(s.includePlanned).toBe(true)
    expect(s.plan).toBe(plan)
  })

  it('is ignored while running or after a run', () => {
    const running = step(choosing(), { type: 'runStarted' })
    expect(finmapDialogReducer(running, { type: 'optionChanged', includePlanned: true })).toBe(running)
  })
})

describe('accountChanged', () => {
  const planWithNew = () => planWith({ create: { accounts: ['Konto Nowe'], categories: [], counterparties: [], tags: [] } })

  it('gives a new account the company currency, type bank and no balance by default', () => {
    expect(accountSettingOf(choosing(planWithNew(), 'EUR'), 'Konto Nowe')).toEqual({ type: 'bank', currency: 'EUR', balanceText: '' })
  })

  it('moves to planning and stores the changed setting by the name key', () => {
    const s = finmapDialogReducer(choosing(planWithNew()), { type: 'accountChanged', name: 'Konto Nowe', patch: { currency: 'USD', balanceText: '12,50' } })
    expect(s.phase).toBe('planning')
    expect(accountSettingOf(s, 'Konto Nowe')).toEqual({ type: 'bank', currency: 'USD', balanceText: '12,50' })
  })

  it('stores a type or a balance without planning again: only the currency takes part in the plan', () => {
    const s = choosing(planWithNew())
    const typed = finmapDialogReducer(s, { type: 'accountChanged', name: 'Konto Nowe', patch: { type: 'card' } })
    expect(typed.phase).toBe('choosing')
    expect(typed.plan).toBe(s.plan)
    const balanced = finmapDialogReducer(typed, { type: 'accountChanged', name: 'Konto Nowe', patch: { balanceText: '1' } })
    expect(balanced.phase).toBe('choosing')
    expect(accountSettingOf(balanced, 'Konto Nowe')).toEqual({ type: 'card', currency: 'PLN', balanceText: '1' })
  })

  it('finds the setting of a name that differs only in case or spacing', () => {
    const s = finmapDialogReducer(choosing(planWithNew()), { type: 'accountChanged', name: 'Konto Nowe', patch: { type: 'cash' } })
    expect(accountSettingOf(s, 'konto  nowe').type).toBe('cash')
  })

  it('is ignored outside choosing', () => {
    const s = step(choosing(planWithNew()), { type: 'runStarted' })
    expect(finmapDialogReducer(s, { type: 'accountChanged', name: 'Konto Nowe', patch: { type: 'cash' } })).toBe(s)
  })
})

describe('checks', () => {
  it('shows progress while checking and the count when it is done', () => {
    let s = choosing()
    s = finmapDialogReducer(s, { type: 'checkProgress', done: 1, total: 4 })
    expect(s.checking).toEqual({ done: 1, total: 4 })
    s = finmapDialogReducer(s, { type: 'checked', alreadyImported: 7 })
    expect(s.checking).toBeNull()
    expect(s.alreadyImported).toBe(7)
    expect(s.phase).toBe('choosing')
  })

  it('a check that stopped shows no count', () => {
    const s = step(choosing(), { type: 'checkProgress', done: 1, total: 4 }, { type: 'checkStopped' })
    expect(s.checking).toBeNull()
    expect(s.alreadyImported).toBeNull()
  })

  it('is ignored outside choosing', () => {
    const s = start()
    expect(finmapDialogReducer(s, { type: 'checked', alreadyImported: 1 })).toBe(s)
    expect(finmapDialogReducer(s, { type: 'checkProgress', done: 0, total: 1 })).toBe(s)
    expect(finmapDialogReducer(s, { type: 'checkStopped' })).toBe(s)
  })
})

describe('runStarted', () => {
  it('starts from choosing when the run is possible, with progress at zero', () => {
    const s = finmapDialogReducer(choosing(), { type: 'runStarted' })
    expect(s.phase).toBe('running')
    expect(s.progress).toEqual({ done: 0, total: 1 })
    expect(s.result).toBeNull()
  })

  it('does nothing when the run is not possible', () => {
    const s = choosing(planWith({ operations: [] }))
    expect(finmapDialogReducer(s, { type: 'runStarted' })).toBe(s)
  })

  it('retries a stopped run with the import it made', () => {
    const stopped = step(choosing(), { type: 'runStarted' }, { type: 'finished', result: { importId: 'imp-7', error: 'network' } })
    expect(stopped.phase).toBe('error')
    const s = finmapDialogReducer(stopped, { type: 'runStarted' })
    expect(s.phase).toBe('running')
    expect(s.importId).toBe('imp-7')
    expect(s.result).toBeNull()
    expect(s.error).toBeNull()
  })

  it('does not retry a run that finished', () => {
    const done = step(choosing(), { type: 'runStarted' }, { type: 'finished', result: { importId: 'imp-1' } })
    expect(done.phase).toBe('done')
    expect(finmapDialogReducer(done, { type: 'runStarted' })).toBe(done)
  })

  it('does not run a stopped run whose plan was refused by the limits', () => {
    const accounts = Array.from({ length: SETUP_LIMITS.accounts + 1 }, (_, i) => `Konto ${i}`)
    const s = choosing(planWith({ create: { accounts, categories: [], counterparties: [], tags: [] } }))
    expect(finmapDialogReducer(s, { type: 'runStarted' })).toBe(s)
  })

  it('does nothing when a new account has a balance that is not a number', () => {
    const plan = planWith({ create: { accounts: ['Konto Nowe'], categories: [], counterparties: [], tags: [] } })
    const s = step(choosing(plan), { type: 'accountChanged', name: 'Konto Nowe', patch: { balanceText: 'abc' } })
    expect(s.phase).toBe('choosing')
    expect(finmapDialogReducer(s, { type: 'runStarted' })).toBe(s)
  })
})

describe('progress', () => {
  it('updates the progress while running', () => {
    const s = step(choosing(), { type: 'runStarted' }, { type: 'progress', done: 1, total: 1 })
    expect(s.progress).toEqual({ done: 1, total: 1 })
  })

  it('is ignored outside running', () => {
    const s = choosing()
    expect(finmapDialogReducer(s, { type: 'progress', done: 1, total: 1 })).toBe(s)
  })
})

describe('finished', () => {
  it('ends a complete run in done and keeps its result and import', () => {
    const result = { importId: 'imp-1', created: 3 }
    const s = step(choosing(), { type: 'runStarted' }, { type: 'finished', result })
    expect(s.phase).toBe('done')
    expect(s.result).toBe(result)
    expect(s.importId).toBe('imp-1')
    expect(s.progress).toBeNull()
    expect(s.error).toBeNull()
  })

  it('ends a busy run in error with the busy code, so a retry can follow', () => {
    const s = step(choosing(), { type: 'runStarted' }, { type: 'finished', result: { importId: 'imp-2', busy: true } })
    expect(s.phase).toBe('error')
    expect(s.error).toEqual({ code: 'busy' })
    expect(s.importId).toBe('imp-2')
  })

  it('ends a run with an error code in error with the failed code', () => {
    const s = step(choosing(), { type: 'runStarted' }, { type: 'finished', result: { importId: null, error: 'ledger_busy' } })
    expect(s.phase).toBe('error')
    expect(s.error).toEqual({ code: 'failed' })
    expect(s.importId).toBeNull()
  })

  it('keeps the earlier import id when a retry gives none', () => {
    const first = step(choosing(), { type: 'runStarted' }, { type: 'finished', result: { importId: 'imp-9', error: 'aborted' } })
    const retry = step(first, { type: 'runStarted' }, { type: 'finished', result: { importId: null, error: 'network' } })
    expect(retry.importId).toBe('imp-9')
  })

  it('is ignored when no run is in progress', () => {
    const s = choosing()
    expect(finmapDialogReducer(s, { type: 'finished', result: { importId: 'x' } })).toBe(s)
  })
})

describe('canRun', () => {
  it('is true for a planned file with operations and no new account', () => {
    expect(canRun(choosing())).toBe(true)
  })

  it('is false before a plan, outside choosing and with no operation to write', () => {
    expect(canRun(start())).toBe(false)
    expect(canRun(finmapDialogReducer(choosing(), { type: 'optionChanged', includePlanned: true }))).toBe(false)
    expect(canRun(choosing(planWith({ operations: [] })))).toBe(false)
  })

  it('is true when every new account has an empty or valid balance', () => {
    const plan = planWith({ create: { accounts: ['Konto A', 'Konto B'], categories: [], counterparties: [], tags: [] } })
    const s = step(choosing(plan), { type: 'accountChanged', name: 'Konto A', patch: { balanceText: '' } }, { type: 'accountChanged', name: 'Konto B', patch: { balanceText: '-1,5' } })
    expect(canRun(s)).toBe(true)
  })

  it('is false when a new account has a balance that is not a decimal', () => {
    const plan = planWith({ create: { accounts: ['Konto A'], categories: [], counterparties: [], tags: [] } })
    const s = step(choosing(plan), { type: 'accountChanged', name: 'Konto A', patch: { balanceText: '1,234' } })
    expect(canRun(s)).toBe(false)
  })

  it('ignores a balance text of an account that is no longer new', () => {
    const planNew = planWith({ create: { accounts: ['Konto A'], categories: [], counterparties: [], tags: [] } })
    const s = step(choosing(planNew), { type: 'accountChanged', name: 'Konto A', patch: { balanceText: 'bad' } }, { type: 'accountChanged', name: 'Konto A', patch: { currency: 'EUR' } }, { type: 'planned', plan: planWith(), have: EMPTY_COMPANY })
    expect(s.phase).toBe('choosing')
    expect(canRun(s)).toBe(true)
  })

  it('is false while a run is in progress or after one finished', () => {
    const running = step(choosing(), { type: 'runStarted' })
    expect(canRun(running)).toBe(false)
    expect(canRun(step(running, { type: 'finished', result: { importId: 'i' } }))).toBe(false)
  })
})

describe('reset', () => {
  it('returns to idle and keeps the company currency', () => {
    const s = finmapDialogReducer(choosing(planWith(), 'UAH'), { type: 'reset' })
    expect(s.phase).toBe('idle')
    expect(s.companyCurrency).toBe('UAH')
    expect(s.plan).toBeNull()
    expect(s.fileName).toBeNull()
  })
})

describe('parseBalanceText', () => {
  it.each([
    ['', null],
    ['   ', null],
  ])('empty %j is ok with no balance', (text, minor) => {
    expect(parseBalanceText(text, 'PLN')).toEqual({ ok: true, minor })
  })

  it.each([
    ['1234,5', 123450],
    ['1234.56', 123456],
    ['0,07', 7],
    ['-12,3', -1230],
    ['+7', 700],
    ['0,00', 0],
    ['-0', 0],
    ['1 234,50', 123450],
    ['1 234,50', 123450],
    [' 99 ', 9900],
  ])('%j is %i minor units', (text, minor) => {
    expect(parseBalanceText(text, 'PLN')).toEqual({ ok: true, minor })
  })

  it.each(['12,345', '1,2,3', 'abc', '12,', ',5', '1e3', '--1', '99999999999999999999', '100000000000,01'])('%j is not a balance', (text) => {
    expect(parseBalanceText(text, 'PLN')).toEqual({ ok: false })
  })

  it('refuses a currency the ledger does not keep', () => {
    expect(parseBalanceText('1', 'XYZ')).toEqual({ ok: false })
  })
})

describe('setup input from the dialog state', () => {
  it('turns the settings of the new accounts into setup accounts, with a typed balance in minor units', () => {
    const plan = planWith({ create: { accounts: ['Konto A', 'Konto B'], categories: [], counterparties: [], tags: [] } })
    let s = choosing(plan, 'PLN')
    s = step(s, { type: 'accountChanged', name: 'Konto A', patch: { type: 'card', currency: 'EUR', balanceText: '10,5' } }, { type: 'planned', plan, have: EMPTY_COMPANY })
    expect(setupAccounts(s)).toEqual([
      { name: 'Konto A', type: 'card', currency: 'EUR', currentBalanceMinor: 1050 },
      { name: 'Konto B', type: 'bank', currency: 'PLN', currentBalanceMinor: null },
    ])
  })

  it('maps every new account name to its currency for the planner', () => {
    const plan = planWith({ create: { accounts: ['Konto A'], categories: [], counterparties: [], tags: [] } })
    let s = choosing(plan, 'PLN')
    s = step(s, { type: 'accountChanged', name: 'Konto A', patch: { currency: 'USD' } }, { type: 'planned', plan, have: EMPTY_COMPANY })
    const currencies = newAccountCurrencies(s)
    expect(currencies[normKeyOf('Konto A')]).toBe('USD')
    expect(Object.keys(currencies)).toHaveLength(1)
  })
})

describe('entitiesOverLimit', () => {
  const with_ = (n: number, key: 'accounts' | 'categories' | 'counterparties' | 'tags'): FinmapPlan =>
    planWith({ create: { accounts: [], categories: [], counterparties: [], tags: [], [key]: Array.from({ length: n }, (_, i) => (key === 'categories' ? { type: 'expense' as const, parent: `K${i}`, child: null } : `${key} ${i}`)) } })

  it('is false at each limit and true one over it', () => {
    expect(entitiesOverLimit(with_(SETUP_LIMITS.accounts, 'accounts'))).toBe(false)
    expect(entitiesOverLimit(with_(SETUP_LIMITS.accounts + 1, 'accounts'))).toBe(true)
    expect(entitiesOverLimit(with_(SETUP_LIMITS.categories, 'categories'))).toBe(false)
    expect(entitiesOverLimit(with_(SETUP_LIMITS.categories + 1, 'categories'))).toBe(true)
    expect(entitiesOverLimit(with_(SETUP_LIMITS.counterparties + 1, 'counterparties'))).toBe(true)
    expect(entitiesOverLimit(with_(SETUP_LIMITS.tags, 'tags'))).toBe(false)
    expect(entitiesOverLimit(with_(SETUP_LIMITS.tags + 1, 'tags'))).toBe(true)
  })
})

describe('companyLimitOf', () => {
  const adds = (n: number, key: 'tags' | 'counterparties'): FinmapPlan =>
    planWith({ create: { accounts: [], categories: [], counterparties: [], tags: [], [key]: Array.from({ length: n }, (_, i) => `${key} ${i}`) } })

  it('is null while the company stays within its caps, counting the archived items it already has', () => {
    expect(companyLimitOf(adds(MAX_TAGS, 'tags'), { tags: 0, counterparties: 0 })).toBeNull()
    expect(companyLimitOf(adds(10, 'tags'), { tags: MAX_TAGS - 10, counterparties: 0 })).toBeNull()
    expect(companyLimitOf(adds(1, 'counterparties'), { tags: 0, counterparties: MAX_COUNTERPARTIES - 1 })).toBeNull()
  })

  it('names the cap the plan goes over, tags first', () => {
    expect(companyLimitOf(adds(1, 'tags'), { tags: MAX_TAGS, counterparties: 0 })).toBe('tags')
    expect(companyLimitOf(adds(1, 'counterparties'), { tags: 0, counterparties: MAX_COUNTERPARTIES })).toBe('counterparties')
  })
})
