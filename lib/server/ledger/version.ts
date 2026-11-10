import { Timestamp } from 'firebase-admin/firestore'
import { parseVersion } from '@/lib/domain/transfers/version'

/** A version the browser carries (`<seconds>.<9 digits of nanoseconds>`, already checked by the request parser) as a Firestore Timestamp. */
export function timestampOf(version: string): Timestamp {
  const parts = parseVersion(version)
  if (parts === null) throw new Error('an unparsed version reached the ledger')
  return new Timestamp(parts.seconds, parts.nanoseconds)
}
