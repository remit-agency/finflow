import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

export type ImportErrorCode = 'invalid_input' | 'not_found' | 'account_not_found' | 'already_running' | 'too_many_operations' | 'payload_too_large'

export class ImportError extends Error {
  public readonly code: ImportErrorCode
  public readonly field?: string
  constructor(code: ImportErrorCode, field?: string) {
    super(code)
    this.name = 'ImportError'
    this.code = code
    this.field = field
  }
}

const STATUS: Record<ImportErrorCode, number> = { invalid_input: 400, not_found: 404, account_not_found: 404, already_running: 409, too_many_operations: 422, payload_too_large: 413 }

export function toImportHttpError(e: unknown): unknown {
  if (e instanceof ImportError) return new HttpError(STATUS[e.code], e.code, e.field === undefined ? undefined : { field: e.field })
  return toHttpError(e)
}
