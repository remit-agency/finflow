import { beforeEach, describe, expect, it } from 'vitest'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'
import { recordConsent } from '@/lib/server/consent'
import { clearFirestore, readDoc, testDb } from './helpers'

const db = testDb()
const UID = 'consent-user'
const NOW = new Date('2026-11-21T10:00:00Z')
const docs = { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy }

describe('recordConsent', () => {
  beforeEach(async () => { await clearFirestore() })

  it('writes the state and one event per document in one go', async () => {
    const state = await recordConsent(db, UID, { docs, source: 'register' }, 'pl', NOW)
    expect(state.terms).toEqual({ version: docs.terms, at: NOW.toISOString(), locale: 'pl' })
    expect(state.privacy?.version).toBe(docs.privacy)
    expect((await readDoc(db, `userConsents/${UID}`))?.terms).toMatchObject({ version: docs.terms })
    const events = await db.collection(`userConsents/${UID}/events`).get()
    expect(events.docs.map((d) => d.data().doc).sort()).toEqual(['privacy', 'terms'])
    expect(events.docs.every((d) => d.data().source === 'register' && d.data().locale === 'pl')).toBe(true)
  })

  it('is idempotent: the same versions again write nothing new', async () => {
    await recordConsent(db, UID, { docs, source: 'register' }, 'pl', NOW)
    await recordConsent(db, UID, { docs, source: 'gate' }, 'en', new Date('2026-11-22T10:00:00Z'))
    expect((await db.collection(`userConsents/${UID}/events`).get()).size).toBe(2)
    expect((await readDoc(db, `userConsents/${UID}`))?.terms).toMatchObject({ locale: 'pl' })
  })

  it('records only the document whose version changed', async () => {
    await db.doc(`userConsents/${UID}`).set({
      terms: { version: '2020-01-01', at: '2020-01-01T00:00:00.000Z', locale: 'pl' },
      privacy: { version: docs.privacy, at: '2026-01-01T00:00:00.000Z', locale: 'pl' },
    })
    await recordConsent(db, UID, { docs, source: 'gate' }, 'uk', NOW)
    const events = await db.collection(`userConsents/${UID}/events`).get()
    expect(events.docs.map((d) => d.data().doc)).toEqual(['terms'])
    expect((await readDoc(db, `userConsents/${UID}`))?.privacy).toMatchObject({ at: '2026-01-01T00:00:00.000Z' })
  })
})
