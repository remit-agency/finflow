import { describe, expect, it } from 'vitest'
import { parseBankAccount, parseConnection } from '@/lib/server/banking/types'

describe('parseConnection', () => {
  it('reads a new document as it is', () => {
    expect(parseConnection({ sessionId: 's1', institutionName: 'Millennium', connectedAt: '2026-10-23T10:00:00.000Z', validUntil: '2027-01-21T10:00:00.000Z', status: 'expired' })).toMatchObject({ validUntil: '2027-01-21T10:00:00.000Z', status: 'expired' })
  })
  it('a connection saved by the old browser flow gets validUntil = connectedAt + 90 days and status active', () => {
    const c = parseConnection({ sessionId: 's1', institutionName: 'Millennium', connectedAt: '2026-10-23T10:00:00.000Z' })
    expect(c?.validUntil).toBe('2027-01-21T10:00:00.000Z')
    expect(c?.status).toBe('active')
  })
  it('a connection saved by the old browser flow (no psuType, no validUntil) was always a personal connection', () => {
    const c = parseConnection({ sessionId: 's1', institutionName: 'Millennium', connectedAt: '2026-10-23T10:00:00.000Z' })
    expect(c?.psuType).toBe('personal')
  })
  it('a new document without psuType (null) stays null, and so does a document with validUntil and no psuType', () => {
    const base = { sessionId: 's1', institutionName: 'Millennium', connectedAt: '2026-10-23T10:00:00.000Z', validUntil: '2027-01-21T10:00:00.000Z', status: 'active' }
    expect(parseConnection({ ...base, psuType: null })?.psuType).toBeNull()
    expect(parseConnection(base)?.psuType).toBeNull()
  })
  it('is null without a session id or a readable connectedAt', () => {
    expect(parseConnection({ institutionName: 'x', connectedAt: '2026-10-23T10:00:00.000Z' })).toBeNull()
    expect(parseConnection({ sessionId: 's1', institutionName: 'x', connectedAt: 'nope' })).toBeNull()
  })
})

describe('parseBankAccount background fields', () => {
  const base = { connectionId: 's1', ebAccountUid: 'eb-u1', accountId: 'a1', currency: 'PLN', importFrom: '2026-07-30' }

  it('reads bgSlot and backoffUntil when present', () => {
    expect(parseBankAccount({ ...base, bgSlot: '2026-10-27#08', backoffUntil: '2026-10-27T16:00:00.000Z' })).toMatchObject({ bgSlot: '2026-10-27#08', backoffUntil: '2026-10-27T16:00:00.000Z' })
  })

  it('an older document without them reads as null', () => {
    expect(parseBankAccount(base)).toMatchObject({ bgSlot: null, backoffUntil: null })
  })

  it('ignores values of the wrong type', () => {
    expect(parseBankAccount({ ...base, bgSlot: 5, backoffUntil: {} })).toMatchObject({ bgSlot: null, backoffUntil: null })
  })
})
