// lib/domain/reports/errors.ts
export type ReportErrorCode = 'invalid_input' | 'too_many_operations' | 'too_many_rates'

/**
 * An expected refusal of a report: a bad parameter (`field`), a period with more documents than `cap` (`too_many_operations`),
 * or more distinct NBP rates than `cap` are needed to value it (`too_many_rates`). All of them are decided before any read
 * of the document or any NBP request that the refusal would have spent.
 */
export class ReportError extends Error {
  public readonly code: ReportErrorCode
  public readonly field?: string
  public readonly cap?: number

  constructor(code: ReportErrorCode, detail: { field?: string; cap?: number } = {}) {
    super(detail.field === undefined ? code : `${code}:${detail.field}`)
    this.name = 'ReportError'
    this.code = code
    this.field = detail.field
    this.cap = detail.cap
  }
}
