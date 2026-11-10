export type RecurringErrorCode = 'invalid_input' | 'not_found' | 'limit_reached'

/** An expected failure of a series operation (S11). `field` names the offending input field. */
export class RecurringError extends Error {
  public readonly code: RecurringErrorCode
  public readonly field?: string

  constructor(code: RecurringErrorCode, field?: string) {
    super(field === undefined ? code : `${code}:${field}`)
    this.name = 'RecurringError'
    this.code = code
    this.field = field
  }
}
