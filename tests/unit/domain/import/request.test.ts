import { describe, expect, it } from 'vitest'
import { parseImportStep, parsePreviewRequest, parseUndoRequest } from '@/lib/domain/import/request'
import { IMPORT_STEP } from '@/lib/domain/import/types'

const op = (over: Record<string, unknown> = {}) => ({ day: '2026-10-02', type: 'expense', amountMinor: 500, ordinal: 0, reference: null, counterpartyName: null, remittance: null, ...over })
const step = (over: Record<string, unknown> = {}) => ({
  importId: 'imp_1',
  fileName: 'extract.sta',
  accountId: 'acc_1',
  statement: { source: 'PL61109010140000071219812874', currency: 'PLN', from: '2026-10-01', to: '2026-10-31', closingMinor: 12345, complete: true },
  operations: [op()],
  last: true,
  ...over,
})

describe('parseImportStep', () => {
  it('accepts a valid step body', () => {
    expect(parseImportStep(step()).ok).toBe(true)
  })

  it.each([
    ['accountId', step({ accountId: undefined })],
    ['operations', step({ operations: Array.from({ length: IMPORT_STEP + 1 }, () => op()) })],
    ['operations[3].day', step({ operations: [op(), op(), op(), op({ day: '2026-13-01' })] })],
    ['operations[0].ordinal', step({ operations: [op({ ordinal: -1 })] })],
    ['fileName', step({ fileName: '' })],
    ['importId', step({ importId: 'a/b' })],
    ['statement.currency', step({ statement: { ...step().statement, currency: 'pln' } })],
    ['statement.complete', step({ statement: { ...step().statement, complete: 'yes' } })],
    ['statement.complete', step({ statement: { ...step().statement, complete: undefined } })],
    ['last', step({ last: 'yes' })],
  ])('refuses a bad body and names the field %s', (field, body) => {
    expect(parseImportStep(body)).toEqual({ ok: false, field })
  })

  it('keeps statement.complete as the client sent it', () => {
    const parsed = parseImportStep(step({ statement: { ...step().statement, complete: false } }))
    expect(parsed.ok && parsed.value.statement.complete).toBe(false)
  })
})

describe('parsePreviewRequest', () => {
  it('accepts a body without accountIds', () => {
    expect(parsePreviewRequest({ fileName: 'a.sta', text: ':20:X' })).toEqual({ ok: true, value: { fileName: 'a.sta', text: ':20:X' } })
  })

  it('accepts accountIds with nulls', () => {
    expect(parsePreviewRequest({ fileName: 'a.sta', text: ':20:X', accountIds: ['acc_1', null] })).toEqual({
      ok: true,
      value: { fileName: 'a.sta', text: ':20:X', accountIds: ['acc_1', null] },
    })
  })

  it('refuses a missing text', () => {
    expect(parsePreviewRequest({ fileName: 'a.sta' })).toEqual({ ok: false, field: 'text' })
  })

  it('refuses a bad accountIds element', () => {
    expect(parsePreviewRequest({ fileName: 'a.sta', text: ':20:X', accountIds: ['acc/1'] })).toEqual({ ok: false, field: 'accountIds' })
  })
})

describe('parseUndoRequest', () => {
  it('accepts a null body', () => {
    expect(parseUndoRequest(null)).toEqual({ ok: true, value: {} })
  })

  it('refuses a bad cursor', () => {
    expect(parseUndoRequest({ cursor: 'a/b' })).toEqual({ ok: false, field: 'cursor' })
  })
})
