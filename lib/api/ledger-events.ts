const EVENT = 'finflow:ledger-changed'

/** Called after the browser changed operations; the journal listens and reloads what it shows. */
export function notifyLedgerChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function onLedgerChanged(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}
