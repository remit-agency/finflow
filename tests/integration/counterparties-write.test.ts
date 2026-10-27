import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { HttpError } from '@/lib/server/http-error'
import type { WhitelistLookup } from '@/lib/domain/counterparties/whitelist'
import type { CounterpartyDeps } from '@/lib/server/counterparties/deps'
import { createCounterparty, updateCounterparty } from '@/lib/server/counterparties/write'
import { auditActions, clearFirestore, ORG, readDoc, seedOrg, testDb, TODAY, UID } from './helpers'

const NRB1 = '61109010140000071219812874'
const NRB2 = '15109010140000071219812874'
const FOUND: WhitelistLookup = { found: true, subject: { name: 'ORLEN', vatStatus: 'active', ibans: [NRB1] } }
const NOT_FOUND: WhitelistLookup = { found: false }

function makeCpDeps(over: Partial<CounterpartyDeps> = {}): CounterpartyDeps {
  return { db: testDb(), now: () => new Date('2026-10-27T10:00:00Z'), today: () => TODAY, lookup: async () => NOT_FOUND, ...over }
}

async function ids(path: string): Promise<string[]> {
  return (await testDb().collection(path).get()).docs.map((d) => d.id).sort()
}

async function failure(p: Promise<unknown>): Promise<CounterpartyError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(CounterpartyError)
    return e as CounterpartyError
  }
  throw new Error('expected a CounterpartyError')
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(testDb())
})

describe('createCounterparty', () => {
  it('writes the document, the name key and an audit entry', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Acme', ibans: [] })
    const doc = await readDoc(testDb(), `organizations/${ORG}/counterparties/${c.id}`)
    expect(doc).toMatchObject({ schemaVersion: 1, name: 'Acme', ibans: [], archived: false, orgId: ORG })
    expect(doc?.createdAt).toBeDefined()
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_acme'])
    expect(await readDoc(testDb(), `organizations/${ORG}/counterpartyKeys/name_acme`)).toEqual({ counterpartyId: c.id })
    expect(await auditActions(testDb(), ORG)).toEqual(['counterparty.create'])
  })

  it('with a NIP found on the white list stores VAT status and marks the IBANs', async () => {
    const lookup = vi.fn(async () => FOUND)
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1, NRB2] })
    expect(lookup).toHaveBeenCalledWith('7740001454')
    expect(c.vat).toEqual({ status: 'active', checkedOn: TODAY })
    expect(c.ibans).toEqual([{ iban: NRB1, onWhitelist: true }, { iban: NRB2, onWhitelist: false }])
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_orlen', 'nip_7740001454'])
  })

  it('with the white list unavailable still saves, with nothing marked', async () => {
    const lookup = async () => {
      throw new CounterpartyError('lookup_unavailable')
    }
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    expect(c.vat).toBeUndefined()
    expect(c.ibans).toEqual([{ iban: NRB1, onWhitelist: null }])
  })

  it('with an unknown NIP saves with no VAT status', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Jan', nip: '5252344078', ibans: [NRB1] })
    expect(c.vat).toBeUndefined()
    expect(c.ibans).toEqual([{ iban: NRB1, onWhitelist: null }])
  })

  it('asks the white list nothing when there is no NIP', async () => {
    const lookup = vi.fn(async () => FOUND)
    await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Acme', ibans: [NRB1] })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuses a second counterparty with the same name, however it is spelled', async () => {
    const first = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Zakład Łączności', ibans: [] })
    const e = await failure(createCounterparty(makeCpDeps(), ORG, UID, { name: 'ZAKLAD  laczności', ibans: [] }))
    expect(e).toMatchObject({ code: 'duplicate', field: 'name', existingId: first.id })
    expect(await ids(`organizations/${ORG}/counterparties`)).toEqual([first.id])
  })

  it('refuses a second counterparty with the same NIP and names the field', async () => {
    const first = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'One', nip: '7740001454', ibans: [] })
    const e = await failure(createCounterparty(makeCpDeps(), ORG, UID, { name: 'Two', nip: '7740001454', ibans: [] }))
    expect(e).toMatchObject({ code: 'duplicate', field: 'nip', existingId: first.id })
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_one', 'nip_7740001454'])
  })

  it('a duplicate costs no white list call (checked before asking)', async () => {
    await createCounterparty(makeCpDeps(), ORG, UID, { name: 'One', nip: '7740001454', ibans: [] })
    const lookup = vi.fn(async () => FOUND)
    const byNip = await failure(createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Two', nip: '7740001454', ibans: [] }))
    expect(byNip).toMatchObject({ code: 'duplicate', field: 'nip' })
    const byName = await failure(createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'one', nip: '5252344078', ibans: [] }))
    expect(byName).toMatchObject({ code: 'duplicate', field: 'name' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('a refused white list question (429) rejects the create and saves nothing', async () => {
    const lookup = async (): Promise<WhitelistLookup> => {
      throw new HttpError(429, 'rate_limited')
    }
    await expect(createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [] })).rejects.toMatchObject({
      status: 429,
      message: 'rate_limited',
    })
    expect(await ids(`organizations/${ORG}/counterparties`)).toEqual([])
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual([])
  })

  it('lets the same name live in two companies', async () => {
    await seedOrg(testDb(), 'org2')
    await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Acme', ibans: [] })
    await expect(createCounterparty(makeCpDeps(), 'org2', UID, { name: 'Acme', ibans: [] })).resolves.toBeDefined()
  })

  // If the emulator aborts some of the five with a contention error (not a CounterpartyError), lower the count to 3.
  it('five parallel creates of one name leave exactly one', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createCounterparty(makeCpDeps(), ORG, UID, { name: 'Race Ltd', ibans: [] })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'duplicate' })
    expect(await ids(`organizations/${ORG}/counterparties`)).toHaveLength(1)
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_race_ltd'])
  })

  it('refuses beyond the limit', async () => {
    const deps = makeCpDeps({ maxCount: 2 })
    await createCounterparty(deps, ORG, UID, { name: 'A', ibans: [] })
    await createCounterparty(deps, ORG, UID, { name: 'B', ibans: [] })
    expect(await failure(createCounterparty(deps, ORG, UID, { name: 'C', ibans: [] }))).toMatchObject({ code: 'limit' })
  })

  it('answers not_found for a company that does not exist', async () => {
    expect(await failure(createCounterparty(makeCpDeps(), 'nope', UID, { name: 'A', ibans: [] }))).toMatchObject({ code: 'not_found' })
  })
})

describe('updateCounterparty', () => {
  it('renaming moves the name key and frees the old name', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Old Name', ibans: [] })
    const after = await updateCounterparty(makeCpDeps(), ORG, UID, c.id, { name: 'New Name' })
    expect(after.name).toBe('New Name')
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_new_name'])
    await expect(createCounterparty(makeCpDeps(), ORG, UID, { name: 'old name', ibans: [] })).resolves.toBeDefined()
    expect(await auditActions(testDb(), ORG)).toEqual(['counterparty.create', 'counterparty.create', 'counterparty.update'])
  })

  it('refuses a NIP that another counterparty has and changes nothing', async () => {
    const a = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'A', nip: '7740001454', ibans: [] })
    const b = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'B', ibans: [] })
    const e = await failure(updateCounterparty(makeCpDeps(), ORG, UID, b.id, { nip: '7740001454' }))
    expect(e).toMatchObject({ code: 'duplicate', field: 'nip', existingId: a.id })
    expect((await readDoc(testDb(), `organizations/${ORG}/counterparties/${b.id}`))?.nip).toBeUndefined()
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_a', 'name_b', 'nip_7740001454'])
  })

  it('a refused white list question (429) rejects the update and changes nothing', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Orlen', ibans: [] })
    const lookup = async (): Promise<WhitelistLookup> => {
      throw new HttpError(429, 'rate_limited')
    }
    await expect(updateCounterparty(makeCpDeps({ lookup }), ORG, UID, c.id, { nip: '7740001454' })).rejects.toMatchObject({ status: 429, message: 'rate_limited' })
    expect((await readDoc(testDb(), `organizations/${ORG}/counterparties/${c.id}`))?.nip).toBeUndefined()
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_orlen'])
    expect(await auditActions(testDb(), ORG)).toEqual(['counterparty.create'])
  })

  it('archiving asks the white list nothing and keeps the keys', async () => {
    const lookup = vi.fn(async () => FOUND)
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    lookup.mockClear()
    const after = await updateCounterparty(makeCpDeps({ lookup }), ORG, UID, c.id, { archived: true })
    expect(after.archived).toBe(true)
    expect(after.vat).toEqual(c.vat)
    expect(lookup).not.toHaveBeenCalled()
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_orlen', 'nip_7740001454'])
  })

  it('changing the IBAN list asks the white list again and re-marks', async () => {
    const lookup = vi.fn(async () => FOUND)
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [] })
    const after = await updateCounterparty(makeCpDeps({ lookup }), ORG, UID, c.id, { ibans: [NRB1, NRB2] })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(after.ibans).toEqual([{ iban: NRB1, onWhitelist: true }, { iban: NRB2, onWhitelist: false }])
  })

  it('with the white list unavailable keeps the stored status and marks for the same NIP', async () => {
    const c = await createCounterparty(makeCpDeps({ lookup: async () => FOUND }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    const down = async (): Promise<WhitelistLookup> => {
      throw new CounterpartyError('lookup_unavailable')
    }
    const after = await updateCounterparty(makeCpDeps({ lookup: down }), ORG, UID, c.id, { ibans: [NRB1, NRB2] })
    expect(after.vat).toEqual(c.vat)
    expect(after.ibans).toEqual([{ iban: NRB1, onWhitelist: true }, { iban: NRB2, onWhitelist: null }])
  })

  it('clearing the NIP removes the NIP key and the VAT status', async () => {
    const c = await createCounterparty(makeCpDeps({ lookup: async () => FOUND }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    const after = await updateCounterparty(makeCpDeps(), ORG, UID, c.id, { nip: null })
    expect(after.nip).toBeUndefined()
    expect(after.vat).toBeUndefined()
    expect(after.ibans).toEqual([{ iban: NRB1, onWhitelist: null }])
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_orlen'])
  })

  it('keeps createdAt, orgId and kind', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'A', ibans: [] })
    const before = await readDoc(testDb(), `organizations/${ORG}/counterparties/${c.id}`)
    await updateCounterparty(makeCpDeps(), ORG, UID, c.id, { address: 'Warszawa' })
    const doc = await readDoc(testDb(), `organizations/${ORG}/counterparties/${c.id}`)
    expect(doc?.createdAt).toEqual(before?.createdAt)
    expect(doc).toMatchObject({ orgId: ORG, address: 'Warszawa' })
  })

  it('answers not_found for an unknown id', async () => {
    expect(await failure(updateCounterparty(makeCpDeps(), ORG, UID, 'nope', { name: 'X' }))).toMatchObject({ code: 'not_found' })
  })
})
