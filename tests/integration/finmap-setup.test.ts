import { beforeEach, describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { normKey } from '@/lib/domain/import/finmap/fold'
import type { FinmapSetupRequest } from '@/lib/domain/import/finmap/request'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { finmapSetup } from '@/lib/server/imports/finmap/setup'
import { ImportError } from '@/lib/server/imports/errors'
import { ORG, UID, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, seedTag, testDb } from './helpers'

const db = testDb()
const NOW = new Date('2026-11-20T10:00:00Z')
const path = (col: string) => `organizations/${ORG}/${col}`

function depsFor(): ImportDeps {
  const ledger = makeDeps(db, { now: () => NOW })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

/** The request of one run: an account with a balance, one without, categories given child first, and names that match existing ones. */
function request(over: Partial<FinmapSetupRequest> = {}): FinmapSetupRequest {
  return {
    fileName: 'Platnosci.xlsx',
    accounts: [
      { name: 'Konto główne', type: 'bank', currency: 'PLN', currentBalanceMinor: 99_999 },
      { name: 'Karta', type: 'card', currency: 'PLN', currentBalanceMinor: 5_000 },
      { name: 'Kasa', type: 'cash', currency: 'EUR', currentBalanceMinor: null },
    ],
    categories: [
      { type: 'expense', parent: 'Transport', child: 'Paliwo' },
      { type: 'expense', parent: 'Dom', child: 'Czynsz' },
      { type: 'income', parent: 'Sprzedaż', child: null },
      { type: 'expense', parent: 'Zdrowie', child: null },
    ],
    counterparties: ['Nowy Dostawca', 'acme sp.  z o.o.'],
    tags: ['prywatne', 'FIRMA'],
    ...over,
  }
}

async function seedExisting(): Promise<void> {
  await seedOrg(db)
  await seedAccount(db, ORG, 'acc-main', 'PLN', 100_000)
  await db.doc(`${path('accounts')}/acc-main`).update({ name: 'Konto główne', color: '#00c896' })
  await seedCategory(db, ORG, 'cat-sales', 'income')
  await db.doc(`${path('categories')}/cat-sales`).update({ name: 'Sprzedaż' })
  await seedCategory(db, ORG, 'cat-home', 'expense')
  await db.doc(`${path('categories')}/cat-home`).update({ name: 'Dom' })
  await seedCategory(db, ORG, 'cat-rent', 'expense')
  await db.doc(`${path('categories')}/cat-rent`).update({ name: 'Czynsz', parentId: 'cat-home' })
  await seedCounterparty(db, ORG, 'cp-acme')
  await db.doc(`${path('counterparties')}/cp-acme`).update({ name: 'ACME Sp. z o.o.' })
  await db.doc(`${path('counterpartyKeys')}/name_acme_sp_z_o_o`).set({ counterpartyId: 'cp-acme' })
  await seedTag(db, ORG, 'tag-firma', { name: 'Firma' })
}

async function countOf(col: string): Promise<number> {
  return (await db.collection(path(col)).get()).size
}

describe('finmapSetup', () => {
  beforeEach(async () => {
    await clearFirestore()
    await seedExisting()
  })

  it('creates what is missing and matches the rest by name (case and spacing do not count)', async () => {
    const r = await finmapSetup(depsFor(), ORG, UID, request())

    expect(r.accounts[normKey('Konto główne')]).toBe('acc-main')
    expect(r.created).toEqual({ accounts: 2, categories: 3, counterparties: 1, tags: 1 })
    expect(r.counterparties[normKey('acme sp.  z o.o.')]).toBe('cp-acme')
    expect(r.tags[normKey('FIRMA')]).toBe('tag-firma')
    expect(r.categories.find((c) => c.ref.child === 'Czynsz')?.id).toBe('cat-rent')
    expect(r.categories.find((c) => c.ref.child === null && c.ref.parent === 'Sprzedaż')?.id).toBe('cat-sales')
    expect(await countOf('accounts')).toBe(3)
    expect(await countOf('counterparties')).toBe(2)
    expect(await countOf('tags')).toBe(2)
  })

  it('writes the new accounts with type, currency, zero opening and the next unused palette colours', async () => {
    const r = await finmapSetup(depsFor(), ORG, UID, request())
    const karta = await readDoc(db, `${path('accounts')}/${r.accounts[normKey('Karta')]}`)
    const kasa = await readDoc(db, `${path('accounts')}/${r.accounts[normKey('Kasa')]}`)
    expect(karta).toMatchObject({ name: 'Karta', type: 'card', currency: 'PLN', openingMinor: 0, balanceMinor: 0, schemaVersion: 2, orgId: ORG })
    expect(kasa).toMatchObject({ name: 'Kasa', type: 'cash', currency: 'EUR', openingMinor: 0, balanceMinor: 0 })
    // acc-main has the first palette colour; the next accounts take the next unused ones, in request order.
    expect(karta?.color).toBe('#6366f1')
    expect(kasa?.color).toBe('#ef4444')
    expect(karta?.createdAt).toBeInstanceOf(Timestamp)
  })

  it('creates parents before children: the child gets its parent id and the parent colour, the parent has no parentId', async () => {
    const r = await finmapSetup(depsFor(), ORG, UID, request())
    // Only the child is named in the request: its parent is created with it, and found here by name.
    const fuel = r.categories.find((c) => c.ref.child === 'Paliwo')
    expect(fuel).toBeDefined()
    const parentDocs = (await db.collection(path('categories')).where('name', '==', 'Transport').get()).docs
    expect(parentDocs).toHaveLength(1)
    const parentId = parentDocs[0].id
    const parent = parentDocs[0].data()
    const child = await readDoc(db, `${path('categories')}/${fuel!.id}`)
    expect(parent).toMatchObject({ name: 'Transport', type: 'expense', orgId: ORG })
    expect('parentId' in parent).toBe(false)
    expect(child).toMatchObject({ name: 'Paliwo', type: 'expense', parentId, color: parent.color, orgId: ORG })
    expect(parent.createdAt).toBeInstanceOf(Timestamp)
  })

  it('a second run with the same body and importId creates nothing and returns the same ids', async () => {
    const first = await finmapSetup(depsFor(), ORG, UID, request())
    const second = await finmapSetup(depsFor(), ORG, UID, request({ importId: first.importId }))

    expect(second.created).toEqual({ accounts: 0, categories: 0, counterparties: 0, tags: 0 })
    expect(second.importId).toBe(first.importId)
    expect(second.accounts).toEqual(first.accounts)
    expect(second.counterparties).toEqual(first.counterparties)
    expect(second.tags).toEqual(first.tags)
    expect(second.categories).toEqual(first.categories)
    expect(await countOf('accounts')).toBe(3)
    expect(await countOf('categories')).toBe(6)
    expect(await countOf('counterparties')).toBe(2)
    expect(await countOf('tags')).toBe(2)
  })

  it('records on the import document: kind finmap, applied, the accounts used, fit targets only for new accounts with a balance, entity counts', async () => {
    const r = await finmapSetup(depsFor(), ORG, UID, request())
    const doc = await readDoc(db, `${path('imports')}/${r.importId}`)
    expect(doc).toMatchObject({ schemaVersion: 1, kind: 'finmap', status: 'applied', fileName: 'Platnosci.xlsx', createdBy: UID, period: { from: null, to: null } })
    const karta = r.accounts[normKey('Karta')]
    expect(doc?.accountIds).toEqual(expect.arrayContaining(['acc-main', karta, r.accounts[normKey('Kasa')]]))
    // The matched account has no fit target (only new accounts are fitted), the new account with no balance has none either.
    expect(doc?.fitTargets).toEqual({ [karta]: 5_000 })
    expect(doc?.entities).toEqual({ accounts: 2, categories: 3, counterparties: 1, tags: 1 })

    // A second run creates nothing and leaves the counts as they were.
    await finmapSetup(depsFor(), ORG, UID, request({ importId: r.importId }))
    const again = await readDoc(db, `${path('imports')}/${r.importId}`)
    expect(again?.entities).toEqual({ accounts: 2, categories: 3, counterparties: 1, tags: 1 })
    expect(again?.fitTargets).toEqual({ [karta]: 5_000 })
  })

  it('refuses a retry importId that is not an applied Finmap import of this company', async () => {
    const r = await finmapSetup(depsFor(), ORG, UID, request())
    await db.doc(`${path('imports')}/${r.importId}`).update({ status: 'undone' })
    await expect(finmapSetup(depsFor(), ORG, UID, request({ importId: r.importId }))).rejects.toMatchObject({ code: 'not_found' })

    await db.doc(`${path('imports')}/mt940-import`).set({
      schemaVersion: 1,
      fileName: 'wyciag.sta',
      accountIds: [],
      createdAt: Timestamp.fromDate(NOW),
      createdBy: UID,
      period: { from: null, to: null },
      counts: { created: 0, skipped: 0, refused: 0 },
      statements: [],
      fit: {},
      status: 'applied',
      undo: { deleted: 0, kept: 0 },
    })
    await expect(finmapSetup(depsFor(), ORG, UID, request({ importId: 'mt940-import' }))).rejects.toBeInstanceOf(ImportError)
    await expect(finmapSetup(depsFor(), ORG, UID, request({ importId: 'missing-import' }))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('does not match the entities of another company', async () => {
    await seedOrg(db, 'org2', 'PLN')
    await db.doc('organizations/org2/accounts/other-acc').set({ name: 'Kasa', type: 'cash', currency: 'PLN', color: '#00c896', openingMinor: 0, balanceMinor: 0, schemaVersion: 2, orgId: 'org2' })
    await db.doc('organizations/org2/counterparties/other-cp').set({ name: 'Nowy Dostawca', schemaVersion: 1, ibans: [], archived: false, orgId: 'org2' })
    await db.doc('organizations/org2/counterpartyKeys/name_nowy_dostawca').set({ counterpartyId: 'other-cp' })

    const r = await finmapSetup(depsFor(), ORG, UID, request({ accounts: [{ name: 'Kasa', type: 'cash', currency: 'PLN', currentBalanceMinor: null }] }))
    expect(r.accounts[normKey('Kasa')]).not.toBe('other-acc')
    expect(r.created.accounts).toBe(1)
    expect(r.counterparties[normKey('Nowy Dostawca')]).not.toBe('other-cp')
    expect(r.created.counterparties).toBe(1)
  })

  it('two simultaneous runs with new names create each entity once', async () => {
    const fresh = request({
      accounts: [{ name: 'Nowe konto', type: 'bank', currency: 'PLN', currentBalanceMinor: null }],
      categories: [{ type: 'expense', parent: 'Nowa kategoria', child: 'Podkategoria' }],
      counterparties: ['Nowy Kontrahent'],
      tags: ['nowa etykieta'],
    })
    await Promise.all([finmapSetup(depsFor(), ORG, UID, fresh), finmapSetup(depsFor(), ORG, UID, fresh)])

    const accounts = (await db.collection(path('accounts')).where('name', '==', 'Nowe konto').get()).size
    const parents = (await db.collection(path('categories')).where('name', '==', 'Nowa kategoria').get()).size
    const children = (await db.collection(path('categories')).where('name', '==', 'Podkategoria').get()).size
    expect({ accounts, parents, children }).toEqual({ accounts: 1, parents: 1, children: 1 })
    expect(await countOf('counterparties')).toBe(2)
    expect(await countOf('tags')).toBe(2)
  })
})
