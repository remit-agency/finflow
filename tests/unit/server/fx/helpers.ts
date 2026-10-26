import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addDays } from '@/lib/server/fx/days'
import type { FxStore } from '@/lib/server/fx/store'
import { FxError, type MonthDoc, type NbpTable } from '@/lib/server/fx/types'

const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'nbp')

/** All recorded months merged, ascending. */
export function fixtureTables(): NbpTable[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as NbpTable[])
}

/** Behaves like the NBP API: a future or inverted range or one over 93 days is an error. */
export function fakeNbp(tables: NbpTable[], today: string) {
  const calls: Array<[string, string]> = []
  const fn = async (from: string, to: string): Promise<NbpTable[]> => {
    calls.push([from, to])
    if (from > to || to > today || addDays(from, 93) < to) throw new FxError('provider_unavailable')
    return tables.filter((t) => t.effectiveDate >= from && t.effectiveDate <= to)
  }
  return { fn, calls }
}

export function memoryStore() {
  const docs = new Map<string, MonthDoc>()
  const sets: string[] = []
  const store: FxStore = {
    get: async (month) => docs.get(month) ?? null,
    set: async (doc) => {
      sets.push(doc.month)
      docs.set(doc.month, doc)
    },
  }
  return { store, docs, sets }
}
