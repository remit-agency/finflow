import 'server-only'
import { RuleError, type RuleErrorCode } from '@/lib/domain/rules/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

const STATUS: Record<RuleErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  limit_reached: 409,
  conflict: 409,
  category_not_found: 422,
  counterparty_not_found: 422,
  counterparty_archived: 422,
}

/** A RuleError becomes an HttpError (the code, plus `field` when set); others go to the ledger mapping. */
export function toRuleHttpError(e: unknown): unknown {
  if (e instanceof RuleError) return new HttpError(STATUS[e.code], e.code, e.field === undefined ? undefined : { field: e.field })
  return toHttpError(e)
}
