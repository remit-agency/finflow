// A persisted choice of the UI, per browser (S12e: the period of the journal's «Майбутні платежі» block). The same rules as the
// sidebar flag (lib/shell/sidebar-store.ts): every storage access is guarded, a failed write still changes the UI for the rest
// of the page session, and the shape fits React's useSyncExternalStore. A stored value that is not one of the choices is the
// fallback.
import { browserLocalStorage, type FlagStorage } from './sidebar-store'

export interface ChoiceStore<T extends string> {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => T
  /** Server render and hydration: the fallback; the client snapshot follows right after. */
  getServerSnapshot: () => T
  set: (value: T) => void
}

export function createChoiceStore<T extends string>(key: string, fallback: T, choices: readonly T[], getStorage: () => FlagStorage | null = browserLocalStorage): ChoiceStore<T> {
  // The last value set on this page wins over storage, so a failed write still changes the UI.
  let memory: T | null = null
  const listeners = new Set<() => void>()
  const read = (): T => {
    try {
      const raw = getStorage()?.getItem(key)
      return choices.find((c) => c === raw) ?? fallback
    } catch {
      return fallback
    }
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => memory ?? read(),
    getServerSnapshot: () => fallback,
    set(value) {
      memory = value
      try {
        getStorage()?.setItem(key, value)
      } catch {
        // The choice lives in memory for this page session.
      }
      for (const listener of listeners) listener()
    },
  }
}
