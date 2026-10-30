import 'server-only'
import { TagError, type TagErrorCode } from '@/lib/domain/tags/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

/** The largest JSON body of a tag create or edit: a 50-character name and three small fields. */
export const TAG_BODY_MAX_BYTES = 4096

const STATUS: Record<TagErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  duplicate: 409,
  limit_reached: 409,
}

/** A TagError becomes an HttpError (the code, plus `field` and `existingId` when set); others go to the ledger mapping. */
export function toTagHttpError(e: unknown): unknown {
  if (e instanceof TagError) {
    const extra: Record<string, unknown> = {}
    if (e.field !== undefined) extra.field = e.field
    if (e.existingId !== undefined) extra.existingId = e.existingId
    return new HttpError(STATUS[e.code], e.code, Object.keys(extra).length > 0 ? extra : undefined)
  }
  return toHttpError(e)
}
