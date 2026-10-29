import { beforeEach, describe, expect, it } from 'vitest'
import { readBankStatus } from '@/lib/server/banking/status'
import { ORG, clearFirestore, seedOrg, testDb } from './helpers'
import { bankDeps, fakeEb, seedBank } from './bank-helpers'

const db = testDb()
const deps = bankDeps(db, fakeEb({}))

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
})

describe('readBankStatus', () => {
  it('owner: connections and accounts with the IBAN reduced to its tail and the bank balance', async () => {
    await seedBank(db, { lastSyncAt: '2026-10-27T09:00:00.000Z', bankBalance: { amountMinor: 123, type: 'CLBD', at: 'x' } })
    const s = await readBankStatus(deps, ORG, 'owner')
    expect(s.connections).toEqual([{ id: 's1', institutionName: 'Millennium', institutionCountry: null, psuType: null, status: 'active', validUntil: '2027-01-21T10:00:00.000Z', connectedAt: '2026-10-23T10:00:00.000Z' }])
    expect(s.accounts).toEqual([{ id: 'ba1', connectionId: 's1', ibanTail: '2874', currency: 'PLN', accountId: 'a1', importFrom: '2026-07-30', lastSyncAt: '2026-10-27T09:00:00.000Z', bankBalanceMinor: 123, status: 'active' }])
  })

  it('accountant and viewer see the connections only', async () => {
    await seedBank(db)
    for (const role of ['accountant', 'viewer'] as const) expect((await readBankStatus(deps, ORG, role)).accounts).toBeUndefined()
  })

  it('a connection whose validUntil day has passed reads as expired even if stored active; a legacy document gets its derived validUntil', async () => {
    await seedBank(db, {}, { validUntil: '2026-10-20T10:00:00.000Z' })
    expect((await readBankStatus(deps, ORG, 'owner')).connections[0].status).toBe('expired')
    await db.doc(`organizations/${ORG}/bankConnections/s1`).set({ sessionId: 's1', institutionName: 'Millennium', connectedAt: '2026-10-23T10:00:00.000Z' })
    expect((await readBankStatus(deps, ORG, 'owner')).connections[0]).toMatchObject({ status: 'active', validUntil: '2027-01-21T10:00:00.000Z' })
  })
})
