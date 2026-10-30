export type TagErrorCode = 'invalid_input' | 'not_found' | 'duplicate' | 'limit_reached'

/**
 * An expected failure of a tag operation. `field` names the offending input field (`invalid_input`, `duplicate`);
 * `existingId` is the tag that already owns the name.
 */
export class TagError extends Error {
  public readonly code: TagErrorCode
  public readonly field?: string
  public readonly existingId?: string

  constructor(code: TagErrorCode, detail: { field?: string; existingId?: string } = {}) {
    super(detail.field === undefined ? code : `${code}:${detail.field}`)
    this.name = 'TagError'
    this.code = code
    this.field = detail.field
    this.existingId = detail.existingId
  }
}
