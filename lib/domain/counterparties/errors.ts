export type CounterpartyErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'duplicate'
  | 'limit'
  | 'conflict'
  | 'lookup_unavailable'

/**
 * An expected failure of a counterparty operation. `field` names the offending input field
 * (`invalid_input`, `duplicate`); `existingId` is the counterparty that already owns the NIP or name.
 */
export class CounterpartyError extends Error {
  public readonly code: CounterpartyErrorCode
  public readonly field?: string
  public readonly existingId?: string

  constructor(code: CounterpartyErrorCode, detail: { field?: string; existingId?: string } = {}) {
    super(detail.field === undefined ? code : `${code}:${detail.field}`)
    this.name = 'CounterpartyError'
    this.code = code
    this.field = detail.field
    this.existingId = detail.existingId
  }
}
