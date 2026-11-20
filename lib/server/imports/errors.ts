import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { TagError } from '@/lib/domain/tags/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

export type ImportErrorCode = 'invalid_input' | 'not_found' | 'account_not_found' | 'already_running' | 'too_many_operations' | 'payload_too_large' | 'limit_reached'

export class ImportError extends Error {
  public readonly code: ImportErrorCode
  public readonly field?: string
  /** The line of the file the refusal is about, when the file gives one (an MT940 file that is not one: its first issue). */
  public readonly line?: number
  constructor(code: ImportErrorCode, field?: string, line?: number) {
    super(code)
    this.name = 'ImportError'
    this.code = code
    this.field = field
    this.line = line
  }
}

const STATUS: Record<ImportErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  account_not_found: 404,
  already_running: 409,
  too_many_operations: 422,
  payload_too_large: 413,
  limit_reached: 422,
}

/**
 * An import error becomes an HttpError with its code (and `field`/`line` when set). A company cap reached by the tag or the
 * counterparty writer (during the setup) is the same refusal: 422 `limit_reached` with the entity as `field`. Others go to the ledger mapping.
 */
export function toImportHttpError(e: unknown): unknown {
  if (e instanceof ImportError) {
    const extra = { ...(e.field === undefined ? {} : { field: e.field }), ...(e.line === undefined ? {} : { line: e.line }) }
    return new HttpError(STATUS[e.code], e.code, Object.keys(extra).length === 0 ? undefined : extra)
  }
  if (e instanceof TagError && e.code === 'limit_reached') return new HttpError(422, 'limit_reached', { field: 'tags' })
  if (e instanceof CounterpartyError && e.code === 'limit') return new HttpError(422, 'limit_reached', { field: 'counterparties' })
  return toHttpError(e)
}
