import { beforeEach, describe, expect, it } from 'vitest'
import { seedExistingOrg, seedSystemCounterparties } from '@/lib/server/counterparties/seed'
import { auditActions, clearFirestore, ORG, readDoc, seedOrg, testDb } from './helpers'

const NOW = new Date('2026-10-27T10:00:00Z')

async function ids(path: string): Promise<string[]> {
  return (await testDb().collection(path).get()).docs.map((d) => d.id).sort()
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(testDb())
})

describe('seedSystemCounterparties (a company being created)', () => {
  it('creates ZUS and Urząd Skarbowy with their name keys inside the caller transaction', async () => {
    const db = testDb()
    await db.runTransaction(async (t) => {
      seedSystemCounterparties(t, db, 'fresh', NOW)
    })
    expect(await ids('organizations/fresh/counterparties')).toEqual(['system_us', 'system_zus'])
    expect(await ids('organizations/fresh/counterpartyKeys')).toEqual(['name_urzad_skarbowy', 'name_zus'])
    expect(await readDoc(db, 'organizations/fresh/counterparties/system_zus')).toMatchObject({ name: 'ZUS', kind: 'zus', archived: false, schemaVersion: 1, orgId: 'fresh' })
  })
})

describe('seedExistingOrg', () => {
  it('a dry run reports what it would create and writes nothing', async () => {
    const result = await seedExistingOrg(testDb(), ORG, NOW, { apply: false })
    expect(result).toEqual({ created: ['system_zus', 'system_us'], skipped: [] })
    expect(await ids(`organizations/${ORG}/counterparties`)).toEqual([])
  })

  it('applies, and a second run creates nothing', async () => {
    expect((await seedExistingOrg(testDb(), ORG, NOW, { apply: true })).created).toEqual(['system_zus', 'system_us'])
    expect(await ids(`organizations/${ORG}/counterparties`)).toEqual(['system_us', 'system_zus'])
    expect(await auditActions(testDb(), ORG)).toEqual(['counterparty.create', 'counterparty.create'])

    const again = await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    expect(again).toEqual({ created: [], skipped: [{ id: 'system_zus', reason: 'exists' }, { id: 'system_us', reason: 'exists' }] })
    expect(await ids(`organizations/${ORG}/counterparties`)).toHaveLength(2)
  })

  it('does not bring back a system record the owner archived', async () => {
    await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    await testDb().doc(`organizations/${ORG}/counterparties/system_zus`).update({ archived: true })
    await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    expect((await readDoc(testDb(), `organizations/${ORG}/counterparties/system_zus`))?.archived).toBe(true)
  })

  it('skips a record whose name a user already took', async () => {
    await testDb().doc(`organizations/${ORG}/counterpartyKeys/name_zus`).set({ counterpartyId: 'user-made' })
    const result = await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    expect(result).toEqual({ created: ['system_us'], skipped: [{ id: 'system_zus', reason: 'name_taken' }] })
  })

  it('refuses a company that does not exist', async () => {
    await expect(seedExistingOrg(testDb(), 'nope', NOW, { apply: true })).rejects.toMatchObject({ code: 'not_found' })
  })
})
