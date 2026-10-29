import { describe, expect, it } from 'vitest'
import { parseConnection } from '@/lib/server/banking/types'

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
