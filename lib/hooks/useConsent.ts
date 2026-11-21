'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase/firebase'
import { useAuth } from '@/lib/hooks/useAuth'
import { gateStatus, parseConsentState, type ConsentState, type GateStatus } from '@/lib/legal/consent'

interface UseConsentResult {
  status: GateStatus
  state: ConsentState | null
}

const NO_USER: UseConsentResult = { status: 'unknown', state: null }

/** What the browser read from `userConsents/{uid}`, kept with the uid it belongs to. */
type Read = { uid: string; value: ConsentState | null | 'error' }

/** Live read of the signed-in person's consent record; the gate asks again as soon as it stops being current. */
export function useConsent(): UseConsentResult {
  const { user } = useAuth()
  const uid = user?.uid ?? null
  const [read, setRead] = useState<Read | null>(null)

  // State is set only inside the snapshot callbacks, never synchronously in the effect body.
  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      doc(db, 'userConsents', uid),
      (snap) => setRead({ uid, value: snap.exists() ? parseConsentState(snap.data()) : null }),
      () => setRead({ uid, value: 'error' }),
    )
  }, [uid])

  if (!uid) return NO_USER
  const value = read?.uid === uid ? read.value : undefined
  return { status: gateStatus(value), state: value === undefined || value === 'error' ? null : value }
}
