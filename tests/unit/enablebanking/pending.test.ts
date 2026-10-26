import { describe, expect, it } from 'vitest'
import { EB_PENDING_KEY, acceptEbAuth } from '@/lib/enablebanking/pending'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const PENDING = JSON.stringify({ name: 'Bank Millennium', authorizationId: 'auth-1' })

describe('acceptEbAuth', () => {
  it('accepts a well-formed payload for a connection this tab started, and is one-shot', () => {
    const storage = memoryStorage({ [EB_PENDING_KEY]: PENDING })

    expect(acceptEbAuth(b64url({ sessionId: 'sess-1' }), storage)).toEqual({
      sessionId: 'sess-1',
      institutionName: 'Bank Millennium',
    })
    expect(storage.data.has(EB_PENDING_KEY)).toBe(false)
    // The same link opened again (or replayed) is no longer accepted.
    expect(acceptEbAuth(b64url({ sessionId: 'sess-1' }), storage)).toBeNull()
  })

  it('falls back to a generic institution name when the pending entry has none', () => {
    const storage = memoryStorage({ [EB_PENDING_KEY]: JSON.stringify({ authorizationId: 'auth-1' }) })
    expect(acceptEbAuth(b64url({ sessionId: 'sess-1' }), storage)?.institutionName).toBe('Bank')
  })

  it('uses the caller-supplied (translated) fallback name when the pending entry has none', () => {
    const storage = memoryStorage({ [EB_PENDING_KEY]: JSON.stringify({ authorizationId: 'auth-1' }) })
    expect(acceptEbAuth(b64url({ sessionId: 'sess-1' }), storage, 'Банк')?.institutionName).toBe('Банк')
  })

  it('accepts padded and unpadded base64url', () => {
    const raw = Buffer.from(JSON.stringify({ sessionId: 'sess-12' })).toString('base64')
    expect(acceptEbAuth(raw, memoryStorage({ [EB_PENDING_KEY]: PENDING }))?.sessionId).toBe('sess-12')
    expect(acceptEbAuth(raw.replace(/=+$/, ''), memoryStorage({ [EB_PENDING_KEY]: PENDING }))?.sessionId).toBe('sess-12')
  })

  it.each([
    ['no pending entry (a link this tab did not start)', null],
    ['a pending entry that is not JSON', 'not json'],
    ['a pending entry that is not an object', '"text"'],
    ['a pending entry that is null', 'null'],
    ['a pending entry that is an array', '[]'],
  ])('rejects %s', (_label, pending) => {
    const storage = memoryStorage(pending === null ? {} : { [EB_PENDING_KEY]: pending })
    expect(acceptEbAuth(b64url({ sessionId: 'attacker-session' }), storage)).toBeNull()
  })

  it.each([
    ['a missing payload', null],
    ['an empty payload', ''],
    ['malformed base64', '%%%not-base64%%%'],
    ['base64 that is not JSON', Buffer.from('not json').toString('base64url')],
    ['JSON that is not an object', b64url('sess-1')],
    ['JSON null', b64url(null)],
    ['a missing sessionId', b64url({})],
    ['a non-string sessionId', b64url({ sessionId: 42 })],
    ['an empty sessionId', b64url({ sessionId: '' })],
    ['a sessionId over 200 characters', b64url({ sessionId: 'x'.repeat(201) })],
  ])('rejects %s and keeps the pending entry', (_label, payload) => {
    const storage = memoryStorage({ [EB_PENDING_KEY]: PENDING })
    expect(acceptEbAuth(payload, storage)).toBeNull()
    // Only an accepted payload consumes the pending entry: a junk link cannot cancel the user's
    // own connection that is still in flight.
    expect(storage.data.get(EB_PENDING_KEY)).toBe(PENDING)
  })

  it('accepts a sessionId of exactly 200 characters', () => {
    const storage = memoryStorage({ [EB_PENDING_KEY]: PENDING })
    expect(acceptEbAuth(b64url({ sessionId: 'x'.repeat(200) }), storage)?.sessionId).toHaveLength(200)
  })
})
