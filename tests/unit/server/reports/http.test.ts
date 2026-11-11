import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { ReportError } from '@/lib/domain/reports/errors'
import { HttpError } from '@/lib/server/http-error'
import { toReportHttpError } from '@/lib/server/reports/http'

describe('toReportHttpError', () => {
  it('a bad parameter is 400 with its field; too many operations is 422 with the cap; the rest goes to the ledger mapping', () => {
    const bad = toReportHttpError(new ReportError('invalid_input', { field: 'to' }))
    expect(bad).toBeInstanceOf(HttpError)
    expect([(bad as HttpError).status, (bad as HttpError).message, (bad as HttpError).extra]).toEqual([400, 'invalid_input', { field: 'to' }])
    const big = toReportHttpError(new ReportError('too_many_operations', { cap: 10_000 })) as HttpError
    expect([big.status, big.message, big.extra]).toEqual([422, 'too_many_operations', { cap: 10_000 }])
    const missing = toReportHttpError(new LedgerError('not_found', 'org')) as HttpError
    expect([missing.status, missing.message]).toEqual([404, 'not_found'])
    const other = new Error('x')
    expect(toReportHttpError(other)).toBe(other)
  })
})
