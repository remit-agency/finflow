import { describe, expect, it } from 'vitest'
import { doneToDoc, parseDone, parseSeries, seriesToDoc } from '@/lib/domain/recurring/doc'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'
import type { DoneMark, Series } from '@/lib/domain/recurring/types'

const series: Series = {
  ...seriesFromInput('ser1', parseSeriesInput({ name: 'ZUS', kind: 'expense', accountId: 'mil', amountMinor: 150_000, frequency: 'monthly', startDate: '2026-11-01', preset: 'zus', counterpartyId: 'system_zus' }), 'PLN'),
  generatedThrough: '2027-02-10',
  dueOn: '2026-11-11',
}

describe('the series document', () => {
  it('round-trips with its fill state; the writer fields are ignored', () => {
    const doc = seriesToDoc(series)
    expect(doc).toMatchObject({ schemaVersion: 1, name: 'ZUS', preset: 'zus', dayOfMonth: 15, weekday: null, weekendRule: 'next', estimated: true, status: 'active', generatedThrough: '2027-02-10', dueOn: '2026-11-11' })
    expect(parseSeries('ser1', { ...doc, orgId: 'org1', createdAt: 'x', version: 3 })).toEqual(series)
  })

  it.each([
    ['another schema', { schemaVersion: 2 }],
    ['an unknown status', { status: 'stopped' }],
    ['no currency', { currency: undefined }],
    ['a fill day that is not a day', { dueOn: 'tomorrow' }],
    ['day 0 of the month', { dayOfMonth: 0 }],
  ])('is unreadable with %s', (_name, change) => {
    const doc: Record<string, unknown> = { ...seriesToDoc(series), ...change }
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete doc[key]
    expect(parseSeries('ser1', doc)).toBeNull()
  })
})

describe('the occurrence mark', () => {
  const mark: DoneMark = {
    id: 'pl_ser1_2026-11-15', seriesId: 'ser1', occurrence: '2026-11-15', reason: 'paid', txId: `bk_${'a'.repeat(32)}`,
    estimated: true, manual: false, plan: { type: 'expense' }, carried: { categoryId: 'zus', tags: ['t1'] },
  }
  const { id: _id, ...fields } = mark
  void _id

  it('round-trips and ignores the writer fields', () => {
    expect(parseDone(mark.id, { ...doneToDoc(fields), at: 'x', by: 'u', planCreatedAt: null })).toEqual(mark)
  })

  it('is unreadable under another id, with an unknown reason or a bad txId', () => {
    const doc = doneToDoc(fields)
    expect(parseDone('pl_ser1_2026-11-16', doc)).toBeNull()
    expect(parseDone(mark.id, { ...doc, reason: 'lost' })).toBeNull()
    expect(parseDone(mark.id, { ...doc, txId: 'a/b' })).toBeNull()
  })
})
