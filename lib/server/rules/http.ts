import 'server-only'
import { RuleError, type RuleErrorCode } from '@/lib/domain/rules/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

/**
 * The largest JSON body of a rule request (create, edit, preview). Limits are in characters and a Cyrillic rule takes two
 * bytes a character: 10 conditions of 20 words of 80 characters are about 33 KB, so 64 KB leaves room for the JSON.
 */
export const RULE_BODY_MAX_BYTES = 64 * 1024

const STATUS: Record<RuleErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  limit_reached: 409,
  conflict: 409,
  category_not_found: 422,
  counterparty_not_found: 422,
  counterparty_archived: 422,
  tag_not_found: 422,
  tag_archived: 422,
}

/** A RuleError becomes an HttpError (the code, plus `field` when set); others go to the ledger mapping. */
export function toRuleHttpError(e: unknown): unknown {
  if (e instanceof RuleError) return new HttpError(STATUS[e.code], e.code, e.field === undefined ? undefined : { field: e.field })
  return toHttpError(e)
}
