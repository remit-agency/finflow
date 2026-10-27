import type { Counterparty, CounterpartyKind } from './types'

export interface SystemCounterpartySpec {
  /** Fixed document id: seeding twice cannot create a second copy. */
  id: string
  kind: CounterpartyKind
  /** Proper names, the same in every language. */
  name: string
}

export const SYSTEM_COUNTERPARTIES: readonly SystemCounterpartySpec[] = [
  { id: 'system_zus', kind: 'zus', name: 'ZUS' },
  { id: 'system_us', kind: 'us', name: 'Urząd Skarbowy' },
]

export function systemCounterparty(spec: SystemCounterpartySpec): Counterparty {
  return { id: spec.id, name: spec.name, ibans: [], archived: false, kind: spec.kind }
}
