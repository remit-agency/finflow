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
  it('is null without a session id or a readable connectedAt', () => {
    expect(parseConnection({ institutionName: 'x', connectedAt: '2026-10-23T10:00:00.000Z' })).toBeNull()
    expect(parseConnection({ sessionId: 's1', institutionName: 'x', connectedAt: 'nope' })).toBeNull()
  })
})
