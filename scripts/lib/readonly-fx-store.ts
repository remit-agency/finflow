// A view of the FX cache that reads and never writes: the dry run of the ledger migration uses it so that
// resolving rates cannot create or update `fxTables/{month}` in production.
import type { FxStore } from '@/lib/server/fx/store'

export function readOnlyFxStore(store: FxStore): FxStore {
  return {
    get: (month) => store.get(month),
    set: async () => undefined,
  }
}
