import { describe, expect, it } from 'vitest'
import { RecurringError } from '@/lib/domain/recurring/errors'
import {
  applySeriesPatch,
  assertSeriesHorizon,
  parseDeleteQuery,
  parseMatchRequest,
  parseSeriesInput,
  parseSeriesPatch,
  parseSkipBody,
  seriesFromInput,
  seriesToRaw,
} from '@/lib/domain/recurring/input'

const BASE = { name: '  Czynsz   biuro ', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-11-01' }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof RecurringError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'ok'
}

describe('parseSeriesInput', () => {
  it('reads a monthly series and fills the defaults', () => {
    expect(parseSeriesInput(BASE)).toEqual({
      name: 'Czynsz biuro', kind: 'expense', accountId: 'mil', tags: [], amountMinor: 250_000, estimated: false,
      frequency: 'monthly', interval: 1, dayOfMonth: 10, weekday: null, startDate: '2026-11-01', weekendRule: 'none',
    })
  })

  it('a preset gives its day, an estimate and the next business day; it is an expense', () => {
    expect(parseSeriesInput({ ...BASE, dayOfMonth: undefined, preset: 'zus' })).toMatchObject({ preset: 'zus', dayOfMonth: 15, estimated: true, weekendRule: 'next' })
    expect(parseSeriesInput({ ...BASE, preset: 'pit4', estimated: false })).toMatchObject({ dayOfMonth: 10, estimated: false, weekendRule: 'next' })
    expect(parseSeriesInput({ ...BASE, dayOfMonth: undefined, preset: 'vat7' })).toMatchObject({ dayOfMonth: 25 })
    expect(code(() => parseSeriesInput({ ...BASE, kind: 'income', preset: 'vat7' }))).toBe('invalid_input:kind')
  })

  it('a weekly series needs its weekday and takes no day of the month', () => {
    expect(parseSeriesInput({ ...BASE, frequency: 'weekly', dayOfMonth: undefined, weekday: 1 })).toMatchObject({ frequency: 'weekly', weekday: 1, dayOfMonth: null })
    expect(code(() => parseSeriesInput({ ...BASE, frequency: 'weekly', weekday: 1 }))).toBe('invalid_input:dayOfMonth')
    expect(code(() => parseSeriesInput({ ...BASE, frequency: 'weekly', dayOfMonth: undefined }))).toBe('invalid_input:weekday')
    expect(code(() => parseSeriesInput({ ...BASE, weekday: 3 }))).toBe('invalid_input:weekday')
  })

  it('every N months needs N from 1 to 24; the other frequencies take none', () => {
    expect(parseSeriesInput({ ...BASE, frequency: 'everyNMonths', interval: 3 })).toMatchObject({ interval: 3 })
    for (const interval of [0, 25, 1.5, '3', undefined]) {
      expect(code(() => parseSeriesInput({ ...BASE, frequency: 'everyNMonths', interval }))).toBe('invalid_input:interval')
    }
    expect(code(() => parseSeriesInput({ ...BASE, interval: 2 }))).toBe('invalid_input:interval')
  })

  it.each([
    ['an unknown key', { seriesId: 'x' }, 'seriesId'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a name of 81 characters', { name: 'x'.repeat(81) }, 'name'],
    ['a zero amount', { amountMinor: 0 }, 'amountMinor'],
    ['a fractional amount', { amountMinor: 10.5 }, 'amountMinor'],
    ['day 32 of the month', { dayOfMonth: 32 }, 'dayOfMonth'],
    ['a start that is not a day', { startDate: '2026-02-30' }, 'startDate'],
    ['an end before the start', { endDate: '2026-10-31' }, 'endDate'],
    ['an unknown weekend rule', { weekendRule: 'later' }, 'weekendRule'],
    ['an unknown preset', { preset: 'cit' }, 'preset'],
    ['eleven tags', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, 'tags'],
    ['a tag twice', { tags: ['t1', 't1'] }, 'tags'],
    ['an account that is not an id', { accountId: 'a/b' }, 'accountId'],
    ['a category that is not an id', { categoryId: '' }, 'categoryId'],
    ['a transfer', { kind: 'transfer' }, 'kind'],
    ['an estimate that is not a flag', { estimated: 'yes' }, 'estimated'],
    ['a comment of 501 characters', { description: 'x'.repeat(501) }, 'description'],
  ])('refuses %s', (_name, change, field) => {
    expect(code(() => parseSeriesInput({ ...BASE, ...change }))).toBe(`invalid_input:${field}`)
  })

  it('keeps the optional fields, trims the comment and drops an empty one', () => {
    expect(parseSeriesInput({ ...BASE, categoryId: 'rent', counterpartyId: 'cp1', tags: ['t1'], description: '  Lokal 3 ', endDate: '2027-12-10' })).toMatchObject({
      categoryId: 'rent', counterpartyId: 'cp1', tags: ['t1'], description: 'Lokal 3', endDate: '2027-12-10',
    })
    expect('description' in parseSeriesInput({ ...BASE, description: '   ' })).toBe(false)
  })
})

describe('the horizon', () => {
  it('a start or an end more than 3650 days ahead is refused', () => {
    expect(code(() => assertSeriesHorizon({ startDate: '2026-11-01' }, '2026-11-10'))).toBe('ok')
    expect(code(() => assertSeriesHorizon({ startDate: '2036-11-07' }, '2026-11-10'))).toBe('ok')
    expect(code(() => assertSeriesHorizon({ startDate: '2036-11-08' }, '2026-11-10'))).toBe('invalid_input:startDate')
    expect(code(() => assertSeriesHorizon({ startDate: '2026-11-01', endDate: '2036-11-08' }, '2026-11-10'))).toBe('invalid_input:endDate')
  })
})

describe('a change of a series', () => {
  const series = seriesFromInput('ser1', parseSeriesInput({ ...BASE, categoryId: 'rent' }), 'PLN')

  it('takes only the editable fields; null clears an optional one', () => {
    expect(parseSeriesPatch({ amountMinor: 260_000, categoryId: null })).toEqual({ changes: { amountMinor: 260_000, categoryId: null }, removeFuture: false })
    expect(code(() => parseSeriesPatch({ kind: 'income' }))).toBe('invalid_input:kind')
    expect(code(() => parseSeriesPatch({ preset: 'zus' }))).toBe('invalid_input:preset')
    expect(code(() => parseSeriesPatch({ amountMinor: null }))).toBe('invalid_input:amountMinor')
    expect(code(() => parseSeriesPatch({}))).toBe('invalid_input:body')
  })

  it('a pause may remove the future plans; nothing else may', () => {
    expect(parseSeriesPatch({ status: 'paused', removeFuture: true })).toEqual({ changes: {}, status: 'paused', removeFuture: true })
    expect(code(() => parseSeriesPatch({ status: 'active', removeFuture: true }))).toBe('invalid_input:removeFuture')
    expect(code(() => parseSeriesPatch({ status: 'stopped' }))).toBe('invalid_input:status')
  })

  it('revalidates the whole series after the change', () => {
    const next = applySeriesPatch(series, parseSeriesPatch({ amountMinor: 260_000, categoryId: null, status: 'paused' }))
    expect(next).toMatchObject({ id: 'ser1', amountMinor: 260_000, status: 'paused', currency: 'PLN' })
    expect(next.categoryId).toBeUndefined()
    expect(code(() => applySeriesPatch(series, parseSeriesPatch({ endDate: '2026-01-01' })))).toBe('invalid_input:endDate')
  })

  it('a switch to weekly drops the day of the month, and back the weekday', () => {
    const weekly = applySeriesPatch(series, parseSeriesPatch({ frequency: 'weekly', weekday: 5 }))
    expect(weekly).toMatchObject({ frequency: 'weekly', weekday: 5, dayOfMonth: null, interval: 1 })
    const back = applySeriesPatch(weekly, parseSeriesPatch({ frequency: 'everyNMonths', interval: 2, dayOfMonth: 5 }))
    expect(back).toMatchObject({ frequency: 'everyNMonths', interval: 2, dayOfMonth: 5, weekday: null })
  })

  it('seriesToRaw is a body parseSeriesInput reads back to the same series', () => {
    expect(seriesFromInput('ser1', parseSeriesInput(seriesToRaw(series)), 'PLN')).toEqual(series)
  })
})

describe('the other bodies', () => {
  it('the delete query says what happens to the future plans (delete by default)', () => {
    expect(parseDeleteQuery(new URLSearchParams(''))).toBe('delete')
    expect(parseDeleteQuery(new URLSearchParams('future=keep'))).toBe('keep')
    expect(code(() => parseDeleteQuery(new URLSearchParams('future=maybe')))).toBe('invalid_input:future')
    expect(code(() => parseDeleteQuery(new URLSearchParams('x=1')))).toBe('invalid_input:x')
  })

  it('a skip names one occurrence day', () => {
    expect(parseSkipBody({ occurrence: '2026-11-15' })).toEqual({ occurrence: '2026-11-15' })
    expect(code(() => parseSkipBody({ occurrence: '15.11.2026' }))).toBe('invalid_input:occurrence')
    expect(code(() => parseSkipBody({ occurrence: '2026-11-15', x: 1 }))).toBe('invalid_input:x')
  })

  const V = '1790000000.000000001'
  const PLAN = 'pl_ser1_2026-11-15'
  const BANK = `bk_${'a'.repeat(32)}`

  it('a confirmation lists pairs with the versions the person saw; an undo lists plan ids', () => {
    expect(parseMatchRequest({ confirm: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] })).toEqual({ kind: 'confirm', items: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] })
    expect(parseMatchRequest({ undo: [PLAN] })).toEqual({ kind: 'undo', planIds: [PLAN] })
  })

  it.each([
    ['both keys', { confirm: [], undo: [] }, 'body'],
    ['no key', {}, 'body'],
    ['an unknown key', { pairs: [] }, 'pairs'],
    ['an empty list', { confirm: [] }, 'confirm'],
    ['51 undos', { undo: Array.from({ length: 51 }, (_, i) => `pl_ser${i}_2026-11-15`) }, 'undo'],
    ['a plan id that is not one', { confirm: [{ planId: 'manual-1', bankId: BANK, versions: [V, V] }] }, 'planId'],
    ['a bank id that is not one', { confirm: [{ planId: PLAN, bankId: 'manual-1', versions: [V, V] }] }, 'bankId'],
    ['a bad version', { confirm: [{ planId: PLAN, bankId: BANK, versions: [V, '1.2'] }] }, 'versions'],
    ['a plan twice', { confirm: [{ planId: PLAN, bankId: BANK, versions: [V, V] }, { planId: PLAN, bankId: `bk_${'b'.repeat(32)}`, versions: [V, V] }] }, 'confirm'],
    ['an undo twice', { undo: [PLAN, PLAN] }, 'undo'],
  ])('refuses %s', (_name, body, field) => {
    expect(code(() => parseMatchRequest(body))).toBe(`invalid_input:${field}`)
  })
})
