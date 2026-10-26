import 'server-only'
import { getAdmin } from '@/lib/server/firebase-admin'
import { fetchNbpTables } from '@/lib/server/fx/nbp'
import { createResolver } from '@/lib/server/fx/resolver'
import { firestoreFxStore } from '@/lib/server/fx/store'
import type { RateSnapshot } from '@/lib/server/fx/types'
import { todayUtcDay } from '@/lib/utils/today'

export { FxError } from '@/lib/server/fx/types'
export type { RateSnapshot } from '@/lib/server/fx/types'

/**
 * The NBP table A rate (table strictly before `date`) from one currency to another, with the
 * evidence a caller stores next to an amount. Throws FxError.
 */
export function resolveRate(from: string, to: string, date: string): Promise<RateSnapshot> {
  return resolver()(from, to, date)
}

// Built once per server process, lazily (Admin is not touched at import time), so the resolver's
// in-memory caches, shared refreshes and failure memo live across requests.
let shared: ReturnType<typeof createResolver> | undefined

function resolver(): ReturnType<typeof createResolver> {
  shared ??= createResolver({
    store: firestoreFxStore(getAdmin().db),
    fetchTables: (a, b) => fetchNbpTables(a, b),
    now: () => Date.now(),
    today: () => todayUtcDay().toISOString().slice(0, 10),
  })
  return shared
}
