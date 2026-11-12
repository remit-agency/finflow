// A persisted on/off flag of the UI, per browser (S12d: the journal's «Майбутні платежі» block is open or closed): a choice
// between '1' and '0' (lib/shell/choice-store.ts), read as a boolean.
import { createChoiceStore } from './choice-store'
import { browserLocalStorage, type FlagStorage } from './sidebar-store'

export interface FlagStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => boolean
  /** Server render and hydration: the default; the client snapshot follows right after. */
  getServerSnapshot: () => boolean
  set: (value: boolean) => void
}

export function createFlagStore(key: string, fallback: boolean, getStorage: () => FlagStorage | null = browserLocalStorage): FlagStore {
  const store = createChoiceStore<'1' | '0'>(key, fallback ? '1' : '0', ['1', '0'], getStorage)
  return {
    subscribe: store.subscribe,
    getSnapshot: () => store.getSnapshot() === '1',
    getServerSnapshot: () => fallback,
    set: (value) => store.set(value ? '1' : '0'),
  }
}
