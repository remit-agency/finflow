import { describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { ReportError } from '@/lib/domain/reports/errors'
import {
  assertNoParams,
  isWholeMonths,
  parseBalancesDate,
  parseExportRequest,
  parseReportQuery,
  reportQueryToParams,
  reportSource,
} from '@/lib/domain/reports/query'
import { MAX_REPORT_DAYS, type ReportQuery } from '@/lib/domain/reports/types'

const params = (s: string): URLSearchParams => new URLSearchParams(s)

/** `code:field` of the ReportError the call throws, `none` when it returns. */
function refusal(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof ReportError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

describe('parseReportQuery', () => {
  it('reads the period and the S10f filters under their journal names', () => {
    expect(parseReportQuery(params('from=2026-01-01&to=2026-12-31&types=income,transfer&cat=_none:expense,cat-a&cp=cp1&tg=_none,vat&accounts=acc1'))).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      filters: { types: ['income', 'transfer'], categoryIds: ['_none:expense', 'cat-a'], counterpartyIds: ['cp1'], tagIds: ['_none', 'vat'], accountIds: ['acc1'] },
    })
    expect(parseReportQuery(params('from=2026-10-01&to=2026-10-01'))).toEqual({ from: '2026-10-01', to: '2026-10-01', filters: EMPTY_ANALYTICS_FILTERS })
  })

  it('refuses a missing or unreal day, an end before the start and a period longer than MAX_REPORT_DAYS', () => {
    expect(refusal(() => parseReportQuery(params('to=2026-10-01')))).toBe('invalid_input:from')
    expect(refusal(() => parseReportQuery(params('from=2026-02-30&to=2026-03-01')))).toBe('invalid_input:from')
    expect(refusal(() => parseReportQuery(params('from=2026-10-02')))).toBe('invalid_input:to')
    expect(refusal(() => parseReportQuery(params('from=2026-10-02&to=2026-10-01')))).toBe('invalid_input:to')
    expect(MAX_REPORT_DAYS).toBe(3660)
    // 2020-01-01..2030-01-07 is 3660 days (2020, 2024 and 2028 are leap years); one more day is too long.
    expect(refusal(() => parseReportQuery(params('from=2020-01-01&to=2030-01-07')))).toBe('none')
    expect(refusal(() => parseReportQuery(params('from=2020-01-01&to=2030-01-08')))).toBe('invalid_input:to')
  })

  it('refuses an unknown or repeated parameter', () => {
    expect(refusal(() => parseReportQuery(params('from=2026-10-01&to=2026-10-31&q=x')))).toBe('invalid_input:q')
    expect(refusal(() => parseReportQuery(params('from=2026-10-01&from=2026-10-02&to=2026-10-31')))).toBe('invalid_input:from')
    expect(refusal(() => parseReportQuery(params('from=2026-10-01&to=2026-10-31&tg=a&tg=b')))).toBe('invalid_input:tg')
  })

  it('refuses a filter value the lenient S10f reader would drop: a bad id, a repeat, more than 30', () => {
    const base = 'from=2026-10-01&to=2026-10-31'
    expect(refusal(() => parseReportQuery(params(`${base}&types=income,refund`)))).toBe('invalid_input:types')
    expect(refusal(() => parseReportQuery(params(`${base}&cat=a.b`)))).toBe('invalid_input:cat')
    expect(refusal(() => parseReportQuery(params(`${base}&cp=x1,x1`)))).toBe('invalid_input:cp')
    const ids = Array.from({ length: 31 }, (_, i) => `acc${i}`).join(',')
    expect(refusal(() => parseReportQuery(params(`${base}&accounts=${ids}`)))).toBe('invalid_input:accounts')
    expect(refusal(() => parseReportQuery(params(`${base}&tg=`)))).toBe('none')
  })

  it('accepts the extra parameters a route names', () => {
    expect(parseReportQuery(params('report=pl&format=csv&from=2026-10-01&to=2026-10-31'), ['report', 'format']).from).toBe('2026-10-01')
  })
})

describe('reportQueryToParams', () => {
  it('writes what parseReportQuery reads back; no filter parameter without a choice', () => {
    const q = parseReportQuery(params('from=2026-01-01&to=2026-03-31&types=expense&cat=cat-a&cp=cp1&tg=vat&accounts=a1,a2'))
    expect(parseReportQuery(reportQueryToParams(q))).toEqual(q)
    expect(reportQueryToParams({ from: '2026-01-01', to: '2026-01-31', filters: EMPTY_ANALYTICS_FILTERS }).toString()).toBe('from=2026-01-01&to=2026-01-31')
  })
})

describe('reportSource', () => {
  const q = (from: string, to: string, filters: AnalyticsFilters = EMPTY_ANALYTICS_FILTERS): ReportQuery => ({ from, to, filters })

  it('the rollups only without filters over whole months; anything else the operations', () => {
    expect(isWholeMonths('2026-01-01', '2026-12-31')).toBe(true)
    expect(isWholeMonths('2026-02-01', '2026-02-28')).toBe(true)
    expect(isWholeMonths('2028-02-01', '2028-02-28')).toBe(false)
    expect(isWholeMonths('2026-11-02', '2026-11-30')).toBe(false)
    expect(reportSource(q('2026-01-01', '2026-12-31'))).toBe('rollups')
    expect(reportSource(q('2026-11-09', '2026-11-15'))).toBe('operations')
    expect(reportSource(q('2026-01-01', '2026-12-31', { ...EMPTY_ANALYTICS_FILTERS, accountIds: ['a1'] }))).toBe('operations')
    expect(reportSource(q('2026-01-01', '2026-12-31', { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['_none'] }))).toBe('operations')
  })
})

describe('the parameters of the other routes', () => {
  it('the balances take one real day and nothing else', () => {
    expect(parseBalancesDate(params('date=2026-10-31'))).toBe('2026-10-31')
    expect(refusal(() => parseBalancesDate(params('')))).toBe('invalid_input:date')
    expect(refusal(() => parseBalancesDate(params('date=2026-10-31&x=1')))).toBe('invalid_input:x')
  })

  it('the dashboard takes no parameter', () => {
    expect(refusal(() => assertNoParams(params('')))).toBe('none')
    expect(refusal(() => assertNoParams(params('a=1')))).toBe('invalid_input:a')
  })

  it('the export names the report and the format next to the query', () => {
    expect(parseExportRequest(params('report=pl&format=xlsx&from=2026-10-01&to=2026-10-31&tg=vat'))).toEqual({
      kind: 'pl',
      format: 'xlsx',
      query: { from: '2026-10-01', to: '2026-10-31', filters: { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] } },
    })
    expect(refusal(() => parseExportRequest(params('report=balance&format=csv&from=2026-10-01&to=2026-10-31')))).toBe('invalid_input:report')
    expect(refusal(() => parseExportRequest(params('report=pl&format=pdf&from=2026-10-01&to=2026-10-31')))).toBe('invalid_input:format')
  })
})
