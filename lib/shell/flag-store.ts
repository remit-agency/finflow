// A persisted on/off flag of the UI, per browser (S12d: the journal's «Майбутні платежі» block is open or closed). The same
// rules as the sidebar flag (lib/shell/sidebar-store.ts): every storage access is guarded, a failed write still toggles the UI
// for the rest of the page session, and the shape fits React's useSyncExternalStore.
import { browserLocalStorage, type FlagStorage } from './sidebar-store'

export interface FlagStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => boolean
  /** Server render and hydration: the default; the client snapshot follows right after. */
  getServerSnapshot: () => boolean
  set: (value: boolean) => void
}

export function createFlagStore(key: string, fallback: boolean, getStorage: () => FlagStorage | null = browserLocalStorage): FlagStore {
  // The last value set on this page wins over storage, so a failed write still toggles the UI.
  let memory: boolean | null = null
  const listeners = new Set<() => void>()
  const read = (): boolean => {
    try {
      const raw = getStorage()?.getItem(key)
      return raw === '1' ? true : raw === '0' ? false : fallback
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
        getStorage()?.setItem(key, value ? '1' : '0')
      } catch {
        // The flag lives in memory for this page session.
      }
      for (const listener of listeners) listener()
    },
  }
}
