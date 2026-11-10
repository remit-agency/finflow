import { describe, expect, it } from 'vitest'
import { counterpartyArchivedState, editorToBody, editorToPatch, initialEditorState, validateEditor, type EditorState } from '@/lib/domain/recurring/editor'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'

const base = { today: '2026-11-10', defaultAccountId: 'mil', formatAmount: (n: number) => String(n).replace('.', ',') }

describe('the series editor (S11)', () => {
  it('a preset whose counterparty is archived asks for another one: the server’s pick would be refused again (C2 loop)', () => {
    const zus: EditorState = { ...initialEditorState({ ...base, preset: 'zus', presetName: 'ZUS' }), amount: '1500', accountId: 'mil' }
    const asked = counterpartyArchivedState(zus)
    expect(asked).toMatchObject({ counterpartyId: '', counterpartyArchived: true })
    expect(validateEditor(asked)).toEqual({ counterparty: true })
    expect(validateEditor({ ...asked, counterpartyId: 'mine' })).toEqual({})
    expect(editorToBody({ ...asked, counterpartyId: 'mine' })).toMatchObject({ counterpartyId: 'mine', preset: 'zus' })
  })

  it('a series without a preset whose counterparty is archived is cleared to none, as before', () => {
    const rent: EditorState = { ...initialEditorState(base), name: 'Czynsz', amount: '2500', accountId: 'mil', counterpartyId: 'old' }
    const cleared = counterpartyArchivedState(rent)
    expect(cleared).toMatchObject({ counterpartyId: '' })
    expect(validateEditor(cleared)).toEqual({})
    expect(editorToBody(cleared)).not.toHaveProperty('counterpartyId')
  })

  it('a preset starts as an estimated expense to ZUS on the 15th, moved to the next business day', () => {
    expect(initialEditorState({ ...base, preset: 'zus', presetName: 'ZUS' })).toMatchObject({
      name: 'ZUS', kind: 'expense', accountId: 'mil', estimated: true, counterpartyId: '', frequency: 'monthly', dayOfMonth: '15', weekendRule: 'next', startDate: '2026-11-10', preset: 'zus',
    })
    expect(initialEditorState({ ...base, preset: 'vat7', presetName: 'VAT-7' })).toMatchObject({ counterpartyId: '', dayOfMonth: '25' })
  })

  it('a preset sends no counterparty unless the person picks one: the server takes the company’s record (I1)', () => {
    const body = editorToBody({ ...initialEditorState({ ...base, preset: 'zus', presetName: 'ZUS' }), accountId: 'mil', amount: '1500' })
    expect(body).not.toHaveProperty('counterpartyId')
    expect(body).toMatchObject({ preset: 'zus' })
  })

  it('a new series starts monthly on today, without a weekend rule', () => {
    expect(initialEditorState(base)).toMatchObject({ name: '', amount: '', estimated: false, dayOfMonth: '10', weekendRule: 'none', preset: null })
  })

  it('names what is missing or wrong', () => {
    const s = initialEditorState({ ...base, defaultAccountId: '' })
    expect(validateEditor({ ...s, dayOfMonth: '32', endDate: '2026-11-01' })).toEqual({ name: true, accountId: true, amount: true, dayOfMonth: true, endDate: true })
    expect(validateEditor({ ...s, name: 'x', accountId: 'mil', amount: '1 234,50', frequency: 'everyNMonths', interval: '25' })).toEqual({ interval: true })
    expect(validateEditor({ ...s, name: 'x', accountId: 'mil', amount: '10', frequency: 'weekly', dayOfMonth: '' })).toEqual({})
  })

  it('builds a body the server reads, the amount in minor units', () => {
    const s: EditorState = { ...initialEditorState({ ...base, preset: 'zus', presetName: 'ZUS' }), amount: '1 234,50', tagIds: ['t1'], description: '  grudzień ' }
    expect(parseSeriesInput(editorToBody(s))).toEqual({
      name: 'ZUS', kind: 'expense', accountId: 'mil', tags: ['t1'], description: 'grudzień', amountMinor: 123_450,
      estimated: true, preset: 'zus', frequency: 'monthly', interval: 1, dayOfMonth: 15, weekday: null, startDate: '2026-11-10', weekendRule: 'next',
    })
  })

  it('an edit sends only what changed, a field the new frequency does not use as null', () => {
    const series = seriesFromInput('ser1', parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-11-01', description: 'Lokal' }), 'PLN')
    const start = initialEditorState({ ...base, series })
    expect(start).toMatchObject({ name: 'Czynsz', amount: '2500', dayOfMonth: '10', description: 'Lokal' })
    expect(editorToPatch(series, start)).toEqual({})
    expect(editorToPatch(series, { ...start, amount: '2600', frequency: 'weekly', weekday: '5', description: '' })).toEqual({
      amountMinor: 260_000, frequency: 'weekly', weekday: 5, dayOfMonth: null, description: null,
    })
  })
})
