import { describe, expect, it } from 'vitest'
import { mostUrgentNotice } from '@/lib/domain/banking/consent'

const c = (id: string, validUntilDay: string, status: 'active' | 'expired' = 'active') => ({ id, institutionName: id, validUntilDay, status })

describe('mostUrgentNotice', () => {
  it('is null when nothing needs attention', () => {
    expect(mostUrgentNotice([], '2026-10-28')).toBeNull()
    expect(mostUrgentNotice([c('a', '2027-01-01')], '2026-10-28')).toBeNull()
  })
  it('picks the most urgent connection: expired, then today, then fewer days', () => {
    expect(mostUrgentNotice([c('a', '2026-10-31'), c('b', '2026-10-29')], '2026-10-28')).toMatchObject({ connection: { id: 'b' }, notice: { kind: 'days', days: 1 } })
    expect(mostUrgentNotice([c('a', '2026-10-28'), c('b', '2026-10-29')], '2026-10-28')).toMatchObject({ connection: { id: 'a' }, notice: { kind: 'today' } })
    expect(mostUrgentNotice([c('a', '2026-10-28'), c('b', '2027-01-01', 'expired')], '2026-10-28')).toMatchObject({ connection: { id: 'b' }, notice: { kind: 'expired' } })
  })
  it('a connection stored as expired is expired whatever its date says', () => {
    expect(mostUrgentNotice([c('a', '2027-06-01', 'expired')], '2026-10-28')?.notice).toEqual({ kind: 'expired' })
  })
})
