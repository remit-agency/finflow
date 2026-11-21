import 'server-only'
import type { Firestore } from 'firebase-admin/firestore'
import { parseConsentState, type ConsentInput, type ConsentState } from '@/lib/legal/consent'
import { CONSENT_DOCS } from '@/lib/legal/versions'

/**
 * Records that `uid` accepted the given versions. One transaction: the state document and one event per CHANGED
 * document. Idempotent: documents already at that version write nothing. `locale` is the language the person saw.
 */
export async function recordConsent(db: Firestore, uid: string, input: ConsentInput, locale: string, now: Date): Promise<ConsentState> {
  const ref = db.doc(`userConsents/${uid}`)
  return db.runTransaction(async (t) => {
    const state = parseConsentState((await t.get(ref)).data())
    const at = now.toISOString()
    const next: ConsentState = { ...state }
    for (const doc of CONSENT_DOCS) {
      if (state[doc]?.version === input.docs[doc]) continue
      next[doc] = { version: input.docs[doc], at, locale }
      t.create(ref.collection('events').doc(), { doc, version: input.docs[doc], at, locale, source: input.source })
    }
    if (CONSENT_DOCS.some((doc) => next[doc] !== state[doc])) t.set(ref, next)
    return next
  })
}
