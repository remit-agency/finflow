// lib/domain/reports/errors.ts
export type ReportErrorCode = 'invalid_input' | 'too_many_operations'

/**
 * An expected refusal of a report: a bad parameter (`field`), or a period with more documents than `cap`
 * (`too_many_operations`). Both are decided before any document is read. The NBP rates never refuse
 * a report: those past MAX_RATE_MONTHS are left unvalued and named (`Reconciliation.unrequestedRates`).
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
