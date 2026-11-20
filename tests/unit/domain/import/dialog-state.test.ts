import { describe, expect, it } from 'vitest'
import {
  canRun,
  dialogErrorOf,
  importDialogReducer,
  initialDialogState,
  needsCount,
  runPlan,
  withAccount,
  type DialogEvent,
  type DialogState,
} from '@/lib/domain/import/dialog-state'
import type { PreviewResult, PreviewStatement } from '@/lib/domain/import/view'
import type { OpStatus } from '@/lib/domain/import/types'
import { MAX_IMPORT_BYTES } from '@/lib/domain/import/types'

function op(over: Partial<{ day: string; type: 'income' | 'expense'; amountMinor: number; reference: string | null; counterpartyName: string | null; remittance: string | null; ordinal: number; status: OpStatus }> = {}) {
  return {
    day: '2026-11-03',
    type: 'expense' as const,
    amountMinor: 1000,
    reference: null,
    counterpartyName: 'SHOP',
    remittance: null,
    ordinal: 0,
    status: 'new' as OpStatus,
    ...over,
  }
}

function statement(index: number, over: Partial<PreviewStatement> = {}): PreviewStatement {
  return {
    index,
    source: 'PL61109010140000071219812874',
    number: '1',
    currency: 'PLN',
    opening: { amountMinor: 0, day: '2026-11-01', currency: 'PLN' },
    closing: { amountMinor: 1000, day: '2026-11-03', currency: 'PLN' },
    from: '2026-11-01',
    to: '2026-11-03',
    reconciliation: 0,
    issues: [],
    suggestedAccountId: 'acc-1',
    operations: [op({ status: 'new' }), op({ ordinal: 1, status: 'seen' })],
    ...over,
  }
}

function preview(statements: PreviewStatement[], issues: PreviewResult['issues'] = []): PreviewResult {
  return { statements, issues, opCount: statements.reduce((n, s) => n + s.operations.length, 0) }
}

function run(state: DialogState, ...events: DialogEvent[]): DialogState {
  return events.reduce(importDialogReducer, state)
}

/** A dialog that has counted `statements` for the accounts they suggest: ready to choose or run. */
function counted(statements: PreviewStatement[], accounts: Array<string | null> = statements.map((s) => s.suggestedAccountId)): DialogState {
  return run(
    initialDialogState,
    { type: 'pick', fileName: 'a.sta', size: 100 },
    { type: 'decoded', text: ':20:X' },
    { type: 'previewed', preview: preview(statements) },
    { type: 'counted', preview: preview(statements), accounts },
  )
}

describe('picking a file', () => {
  it('reads a file of at most MAX_IMPORT_BYTES', () => {
    const state = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: MAX_IMPORT_BYTES })
    expect(state.phase).toBe('reading')
    expect(state.fileName).toBe('a.sta')
  })

  it('refuses a larger file before it is read', () => {
    const state = run(initialDialogState, { type: 'pick', fileName: 'big.sta', size: MAX_IMPORT_BYTES + 1 })
    expect(state.phase).toBe('error')
    expect(state.error).toEqual({ code: 'too_big', line: null })
  })

  it('accepts a new file after a finished import and clears the old result', () => {
    const done = run(counted([statement(0)]), { type: 'run' }, { type: 'finished' })
    const next = run(done, { type: 'pick', fileName: 'b.sta', size: 10 })
    expect(next.phase).toBe('reading')
    expect(next.outcomes).toEqual([])
    expect(next.preview).toBeNull()
  })

  it.each(['reading', 'previewing', 'counting', 'running'] as const)('ignores a pick while %s', (phase) => {
    const busy: DialogState = { ...initialDialogState, phase, fileName: 'a.sta' }
    expect(run(busy, { type: 'pick', fileName: 'b.sta', size: 10 })).toBe(busy)
  })
})

describe('reading and previewing', () => {
  it('moves from reading to previewing with the decoded text', () => {
    const reading = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 })
    const next = run(reading, { type: 'decoded', text: ':20:X' })
    expect(next.phase).toBe('previewing')
    expect(next.text).toBe(':20:X')
  })

  it('counts the statements when the preview suggests an account for one of them', () => {
    const previewing = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 }, { type: 'decoded', text: ':20:X' })
    const next = run(previewing, { type: 'previewed', preview: preview([statement(0), statement(1, { suggestedAccountId: null })]) })
    expect(next.phase).toBe('counting')
    expect(next.accounts).toEqual(['acc-1', null])
    expect(next.countedFor).toBeNull()
  })

  it('goes to choosing without a count when no statement has a suggested account', () => {
    const previewing = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 }, { type: 'decoded', text: ':20:X' })
    const next = run(previewing, { type: 'previewed', preview: preview([statement(0, { suggestedAccountId: null })]) })
    expect(next.phase).toBe('choosing')
    expect(next.accounts).toEqual([null])
    expect(canRun(next)).toBe(false)
  })

  it('reports the first issue line when the file has no statement', () => {
    const previewing = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 }, { type: 'decoded', text: 'x' })
    const next = run(previewing, { type: 'previewed', preview: preview([], [{ code: 'no_statement', line: 3 }]) })
    expect(next.phase).toBe('error')
    expect(next.error).toEqual({ code: 'not_mt940', line: 3 })
  })

  it('reports not_mt940 without a line when the file gives none', () => {
    const previewing = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 }, { type: 'decoded', text: 'x' })
    expect(run(previewing, { type: 'previewed', preview: preview([]) }).error).toEqual({ code: 'not_mt940', line: null })
  })

  it('ignores decoded and previewed outside their phase', () => {
    expect(run(initialDialogState, { type: 'decoded', text: 'x' })).toBe(initialDialogState)
    expect(run(initialDialogState, { type: 'previewed', preview: preview([statement(0)]) })).toBe(initialDialogState)
  })
})

describe('dialogErrorOf: the server refusal as a dialog error', () => {
  it('a file that is not MT940 (invalid_input in the file field) is not_mt940 with the line the server gives', () => {
    expect(dialogErrorOf(400, 'invalid_input', { error: 'invalid_input', field: 'file', line: 3 })).toEqual({ code: 'not_mt940', line: 3 })
  })

  it('a file not MT940 without a line is not_mt940 with no line', () => {
    expect(dialogErrorOf(400, 'invalid_input', { error: 'invalid_input', field: 'file' })).toEqual({ code: 'not_mt940', line: null })
  })

  it('another invalid input is a plain failure', () => {
    expect(dialogErrorOf(400, 'invalid_input', { error: 'invalid_input', field: 'accountIds' })).toEqual({ code: 'failed', line: null })
  })

  it('the other refusals keep their codes', () => {
    expect(dialogErrorOf(413, 'payload_too_large')).toEqual({ code: 'too_big', line: null })
    expect(dialogErrorOf(422, 'too_many_operations')).toEqual({ code: 'too_many', line: null })
    expect(dialogErrorOf(409, 'already_running')).toEqual({ code: 'busy', line: null })
    expect(dialogErrorOf(500, 'unknown')).toEqual({ code: 'failed', line: null })
  })
})

describe('failures', () => {
  it('a file that cannot be read is an error', () => {
    const reading = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 })
    const next = run(reading, { type: 'failed', error: { code: 'failed', line: null } })
    expect(next.phase).toBe('error')
    expect(next.error).toEqual({ code: 'failed', line: null })
  })

  it('a failure while idle is ignored', () => {
    expect(run(initialDialogState, { type: 'failed', error: { code: 'failed', line: null } })).toBe(initialDialogState)
  })
})

describe('counting', () => {
  it('replaces the preview with the counted one and remembers the accounts counted', () => {
    const next = counted([statement(0)], ['acc-2'])
    expect(next.phase).toBe('choosing')
    expect(next.countedFor).toEqual(['acc-2'])
    expect(next.accounts).toEqual(['acc-2'])
  })

  it('a failed count is an error', () => {
    const counting = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 }, { type: 'decoded', text: 'x' }, { type: 'previewed', preview: preview([statement(0)]) })
    const next = run(counting, { type: 'failed', error: { code: 'failed', line: null } })
    expect(next.phase).toBe('error')
    expect(next.error).toEqual({ code: 'failed', line: null })
  })

  it('ignores counted outside counting', () => {
    const choosing = counted([statement(0)])
    expect(run(choosing, { type: 'counted', preview: preview([]), accounts: [null] })).toBe(choosing)
  })
})

describe('choosing an account', () => {
  it('counts again when a statement gets another account', () => {
    const next = run(counted([statement(0)]), { type: 'choose', index: 0, accountId: 'acc-9' })
    expect(next.phase).toBe('counting')
    expect(next.accounts).toEqual(['acc-9'])
    expect(next.countedFor).toEqual(['acc-1'])
  })

  it('stays in choosing when the choice leaves the accounts as they were counted', () => {
    const next = run(counted([statement(0)]), { type: 'choose', index: 0, accountId: 'acc-1' })
    expect(next.phase).toBe('choosing')
    expect(next.accounts).toEqual(['acc-1'])
  })

  it('ignores a choice outside choosing', () => {
    const counting = run(counted([statement(0)]), { type: 'choose', index: 0, accountId: 'acc-9' })
    expect(run(counting, { type: 'choose', index: 0, accountId: null })).toBe(counting)
  })

  it('withAccount replaces one entry and keeps the others', () => {
    expect(withAccount(['a', null, 'c'], 1, 'b')).toEqual(['a', 'b', 'c'])
    expect(withAccount(['a', 'b'], 0, null)).toEqual([null, 'b'])
  })

  it('needsCount is true until the accounts are counted', () => {
    expect(needsCount(null, ['a'])).toBe(true)
    expect(needsCount(['a'], ['a'])).toBe(false)
    expect(needsCount(['a'], ['b'])).toBe(true)
    expect(needsCount(['a'], ['a', null])).toBe(true)
  })
})

describe('running the import', () => {
  it('is possible once a statement with an account has new operations', () => {
    expect(canRun(counted([statement(0)]))).toBe(true)
  })

  it('is not possible when every chosen statement has no new operation', () => {
    const seenOnly = statement(0, { operations: [op({ status: 'seen' })] })
    expect(canRun(counted([seenOnly]))).toBe(false)
  })

  it('is not possible before the counting', () => {
    const state = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 }, { type: 'decoded', text: 'x' }, { type: 'previewed', preview: preview([statement(0, { suggestedAccountId: null })]) })
    expect(canRun(state)).toBe(false)
  })

  it('starts with the progress total of the operations to send', () => {
    const next = run(counted([statement(0)]), { type: 'run' })
    expect(next.phase).toBe('running')
    expect(next.progress).toEqual({ done: 0, total: 1 })
    expect(next.outcomes).toEqual([])
  })

  it('is ignored when nothing can run', () => {
    const seenOnly = counted([statement(0, { operations: [op({ status: 'seen' })] })])
    expect(run(seenOnly, { type: 'run' })).toBe(seenOnly)
  })

  it('collects the outcomes and finishes as done', () => {
    const outcome = { index: 0, accountId: 'acc-1', created: 1, skipped: { seen: 0, bank: 0 }, refused: [], fitted: false, differenceMinor: 0, busy: false }
    const next = run(counted([statement(0)]), { type: 'run' }, { type: 'progress', done: 1 }, { type: 'outcome', outcome }, { type: 'finished' })
    expect(next.phase).toBe('done')
    expect(next.progress).toBeNull()
    expect(next.outcomes).toEqual([outcome])
  })

  it('keeps the outcomes of a failed run', () => {
    const outcome = { index: 0, accountId: 'acc-1', created: 1, skipped: { seen: 0, bank: 0 }, refused: [], fitted: false, differenceMinor: null, busy: false }
    const next = run(counted([statement(0)]), { type: 'run' }, { type: 'outcome', outcome }, { type: 'failed', error: { code: 'busy', line: null } })
    expect(next.phase).toBe('error')
    expect(next.error).toEqual({ code: 'busy', line: null })
    expect(next.outcomes).toEqual([outcome])
  })
})

describe('runPlan', () => {
  it('lists the statements with an account in file order, skipping the others', () => {
    const statements = [statement(0, { suggestedAccountId: 'acc-1' }), statement(1, { suggestedAccountId: null }), statement(2, { suggestedAccountId: 'acc-3' })]
    const plan = runPlan(counted(statements))
    expect(plan.map((p) => [p.index, p.accountId])).toEqual([
      [0, 'acc-1'],
      [2, 'acc-3'],
    ])
  })

  it('sends only the new operations, without the status, with the fields of the request', () => {
    const plan = runPlan(counted([statement(0)]))
    expect(plan[0].operations).toEqual([{ day: '2026-11-03', type: 'expense', amountMinor: 1000, reference: null, counterpartyName: 'SHOP', remittance: null, ordinal: 0 }])
  })

  it('keeps a statement with no new operation, so that its last step can still fit the balance', () => {
    const plan = runPlan(counted([statement(0, { operations: [op({ status: 'seen' })] })]))
    expect(plan).toHaveLength(1)
    expect(plan[0].operations).toEqual([])
  })

  it('carries the statement fields of the request', () => {
    const plan = runPlan(counted([statement(0)]))
    expect(plan[0].statement).toEqual({ source: 'PL61109010140000071219812874', currency: 'PLN', from: '2026-11-01', to: '2026-11-03', closingMinor: 1000, complete: true })
  })

  it('marks a statement complete only when it parsed with no issue and adds up', () => {
    const complete = (over: Partial<PreviewStatement>) => runPlan(counted([statement(0, over)]))[0].statement.complete
    expect(complete({})).toBe(true)
    expect(complete({ issues: [{ code: 'bad_61', line: 7, tag: '61' }] })).toBe(false)
    expect(complete({ reconciliation: 500 })).toBe(false)
    expect(complete({ reconciliation: null })).toBe(false)
  })

  it('is not complete when every line of the statement is refused', () => {
    const refused = statement(0, { operations: [op({ status: 'refused:future_date' })] })
    expect(runPlan(counted([refused]))[0].statement.complete).toBe(false)
  })

  it('keeps the parse issues of the file in the preview the dialog shows', () => {
    const issues = [{ code: 'orphan_86' as const, line: 12, tag: '86' }]
    const state = run(initialDialogState, { type: 'pick', fileName: 'a.sta', size: 10 }, { type: 'decoded', text: 'x' }, { type: 'previewed', preview: preview([statement(0, { issues })], issues) })
    expect(state.preview?.issues).toEqual(issues)
    expect(state.preview?.statements[0].issues).toEqual(issues)
  })

  it('numbers identical lines of two statements of one account in file order, so that they do not collapse', () => {
    const same = op({ ordinal: 0, reference: null, counterpartyName: 'SHOP', remittance: 'Kawa', status: 'new' })
    const first = statement(0, { suggestedAccountId: 'acc-1', operations: [same] })
    const second = statement(1, { suggestedAccountId: 'acc-1', operations: [{ ...same }] })
    const plan = runPlan(counted([first, second], ['acc-1', 'acc-1']))
    expect(plan.map((item) => item.operations.map((o) => o.ordinal))).toEqual([[0], [1]])
  })

  it('keeps identical lines of statements of different accounts at ordinal 0', () => {
    const same = op({ ordinal: 0, reference: null, counterpartyName: 'SHOP', remittance: 'Kawa', status: 'new' })
    const first = statement(0, { suggestedAccountId: 'acc-1', operations: [same] })
    const second = statement(1, { suggestedAccountId: 'acc-2', operations: [{ ...same }] })
    const plan = runPlan(counted([first, second], ['acc-1', 'acc-2']))
    expect(plan.map((item) => item.operations.map((o) => o.ordinal))).toEqual([[0], [0]])
  })

  it('numbers the lines of an account over all its statements, so a line seen in an earlier statement keeps its place', () => {
    const same = op({ ordinal: 0, reference: null, counterpartyName: 'SHOP', remittance: 'Kawa', status: 'new' })
    const seenFirst = statement(0, { suggestedAccountId: 'acc-1', operations: [{ ...same, status: 'seen' }] })
    const newSecond = statement(1, { suggestedAccountId: 'acc-1', operations: [{ ...same }] })
    const plan = runPlan(counted([seenFirst, newSecond], ['acc-1', 'acc-1']))
    expect(plan[1].operations.map((o) => o.ordinal)).toEqual([1])
  })

  it('is empty before the counting', () => {
    expect(runPlan(initialDialogState)).toEqual([])
  })
})
