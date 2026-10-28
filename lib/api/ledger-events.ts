const EVENT = 'finflow:ledger-changed'

/** How many `withoutNotifications` calls are running; while it is above zero, notifications are held back. */
let muted = 0

/** Called after the browser changed operations; the journal listens and reloads what it shows. */
export function notifyLedgerChanged(): void {
  if (muted > 0) return
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

/**
 * Runs `fn` with notifications held back and sends ONE when the outermost call settles (whether it resolved or
 * threw), so a loop of single-operation calls (a bulk undo) reloads the journal once instead of once per row.
 */
export async function withoutNotifications<T>(fn: () => Promise<T>): Promise<T> {
  muted++
  try {
    return await fn()
  } finally {
    muted--
    notifyLedgerChanged()
  }
}

export function onLedgerChanged(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}
