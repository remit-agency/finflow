import 'server-only'
import type { CounterpartyInput, CounterpartyPatch } from '@/lib/domain/counterparties/input'
import type { VatStatus } from '@/lib/domain/counterparties/types'
import { toDay } from '@/lib/domain/ledger/days'
import { getAdmin } from '@/lib/server/firebase-admin'
import { enforceRateLimit, LOOKUP_LIMITS } from '@/lib/server/rate-limit-guard'
import { todayUtcDay } from '@/lib/utils/today'
import type { CounterpartyDeps } from './deps'
import { lookupNip } from './whitelist'
import { createCounterparty, updateCounterparty } from './write'

export interface LookupAnswer {
  found: boolean
  name?: string
  address?: string
  vatStatus?: VatStatus
  ibans: string[]
  /** The Warsaw day the white list was asked. */
  checkedOn: string
}

function deps(): CounterpartyDeps {
  const today = () => toDay(todayUtcDay())
  return { db: getAdmin().db, now: () => new Date(), today, lookup: (nip) => lookupNip(nip, today()) }
}

/** The counterparties service bound to production Firestore, the MF white list and the Warsaw clock. */
export const counterparties = {
  create: (orgId: string, uid: string, input: CounterpartyInput) => createCounterparty(deps(), orgId, uid, input),
  update: (orgId: string, uid: string, id: string, patch: CounterpartyPatch) => updateCounterparty(deps(), orgId, uid, id, patch),
  /** Counts against the caller's lookup limit, asks the white list and answers what it found (nothing is saved). */
  lookup: async (uid: string, nip: string): Promise<LookupAnswer> => {
    await enforceRateLimit(uid, 'lookup', LOOKUP_LIMITS)
    const d = deps()
    const checkedOn = d.today()
    const result = await d.lookup(nip)
    if (!result.found) return { found: false, ibans: [], checkedOn }
    const { name, address, vatStatus, ibans } = result.subject
    return { found: true, name, ...(address === undefined ? {} : { address }), vatStatus, ibans, checkedOn }
  },
}
