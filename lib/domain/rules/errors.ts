export type RuleErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'limit_reached'
  | 'conflict'
  | 'category_not_found'
  | 'counterparty_not_found'
  | 'counterparty_archived'

/** An expected failure of a rule operation. `field` names the offending input field, if any. */
export class RuleError extends Error {
  public readonly code: RuleErrorCode
  public readonly field?: string

  constructor(code: RuleErrorCode, field?: string) {
    super(field === undefined ? code : `${code}:${field}`)
    this.name = 'RuleError'
    this.code = code
    this.field = field
  }
}
