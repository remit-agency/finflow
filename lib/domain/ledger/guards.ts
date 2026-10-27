import { LedgerError } from './errors'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const RESERVED = /^__.*__$/

export function bad(field: string): never {
  throw new LedgerError('invalid_input', field)
}

/** A Firestore-safe document id from a request. Dots are excluded, `__x__` is reserved. */
export function isId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v) && !RESERVED.test(v)
}

export function asRecord(v: unknown, field = 'body'): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field)
  return v as Record<string, unknown>
}

export function onlyKeys(r: Record<string, unknown>, allowed: readonly string[], prefix = ''): void {
  for (const k of Object.keys(r)) if (!allowed.includes(k)) bad(`${prefix}${k}`)
}
