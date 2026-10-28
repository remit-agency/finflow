'use client'

import { useSyncExternalStore } from 'react'

const PHONE_QUERY = '(max-width: 639px)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * True below the `sm` breakpoint (640 px). The server and the hydration pass answer false, so a label that
 * differs between phone and desktop switches right after hydration without a mismatch.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}
