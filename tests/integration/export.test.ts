import { beforeEach, describe, expect, it } from 'vitest'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { EXPORT_COLLECTIONS, EXPORT_PAGE_BYTES, EXPORT_PAGE_DOCS, type ExportCollection } from '@/lib/domain/export/collections'
import { readExportPage, type ExportDoc, type ExportPage } from '@/lib/server/export/read'
import { clearFirestore, ORG, seedOrg, testDb } from './helpers'

const db = testDb()

async function readAll(collection: ExportCollection): Promise<{ pages: ExportPage[]; docs: ExportDoc[] }> {
  const pages: ExportPage[] = []
  let after: string | null = null
  do {
    const page: ExportPage = await readExportPage(db, ORG, collection, after)
    pages.push(page)
    after = page.next
  } while (after !== null && pages.length < 100)
  return { pages, docs: pages.flatMap((p) => p.docs) }
}

async function writeAll(firestore: Firestore, docs: { path: string; data: Record<string, unknown> }[]): Promise<void> {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = firestore.batch()
    for (const d of docs.slice(i, i + 400)) batch.set(firestore.doc(d.path), d.data)
    await batch.commit()
  }
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
})

describe('readExportPage', () => {
  it('pages 1200 documents in id order, each exactly once', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `tx${String(i).padStart(4, '0')}`)
    await writeAll(db, ids.map((id, i) => ({ path: `organizations/${ORG}/transactions/${id}`, data: { orgId: ORG, amountMinor: i, createdAt: Timestamp.fromDate(new Date('2026-10-27T10:00:00Z')) } })))

    const first = await readExportPage(db, ORG, 'transactions', null)
    expect(first.docs.length).toBeLessThanOrEqual(EXPORT_PAGE_DOCS)
    expect(first.next).not.toBeNull()

    const { pages, docs } = await readAll('transactions')
    expect(pages.length).toBeGreaterThanOrEqual(3)
    expect(pages.at(-1)?.next).toBeNull()
    expect(docs.map((d) => d.id)).toEqual(ids)
    expect(docs[7].data.amountMinor).toBe(7)
  })

  it('exports a bank connection without any field outside the parsed allow-list', async () => {
    await db.doc(`organizations/${ORG}/bankConnections/sess1`).set({
      sessionId: 'sess1', institutionName: 'Bank A', institutionCountry: 'PL', psuType: 'business',
      connectedAt: '2026-10-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', status: 'active',
      accessToken: 'SECRET', refreshToken: 'SECRET2',
    })
    const { docs } = await readAll('bankConnections')
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe('sess1')
    expect(Object.keys(docs[0].data).sort()).toEqual(['connectedAt', 'institutionCountry', 'institutionName', 'psuType', 'sessionId', 'status', 'validUntil'])
    expect(JSON.stringify(docs)).not.toContain('SECRET')
  })

  it('skips an unreadable bank connection but still advances the cursor past it', async () => {
    await db.doc(`organizations/${ORG}/bankConnections/a`).set({ sessionId: 'a', connectedAt: 'not a date', accessToken: 'SECRET' })
    await db.doc(`organizations/${ORG}/bankConnections/b`).set({ sessionId: 'b', connectedAt: '2026-10-01T00:00:00.000Z', institutionName: 'B', accessToken: 'SECRET' })
    const { docs } = await readAll('bankConnections')
    expect(docs.map((d) => d.id)).toEqual(['b'])
    expect(JSON.stringify(docs)).not.toContain('SECRET')
  })

  it('turns Timestamps into ISO strings, also nested', async () => {
    const at = new Date('2026-10-27T10:00:00.123Z')
    await db.doc(`organizations/${ORG}/members/u1`).set({ uid: 'u1', role: 'owner', createdAt: Timestamp.fromDate(at), nested: { list: [Timestamp.fromDate(at)] } })
    const { docs } = await readAll('members')
    expect(docs[0].data.createdAt).toBe('2026-10-27T10:00:00.123Z')
    expect((docs[0].data.nested as { list: unknown[] }).list[0]).toBe('2026-10-27T10:00:00.123Z')
  })

  it('returns the company document once with no next page', async () => {
    await db.doc(`organizations/${ORG}`).set({ trialEndsAt: Timestamp.fromDate(new Date('2026-11-10T00:00:00Z')) }, { merge: true })
    const page = await readExportPage(db, ORG, 'organization', null)
    expect(page.next).toBeNull()
    expect(page.docs).toHaveLength(1)
    expect(page.docs[0].id).toBe(ORG)
    expect(page.docs[0].data).toMatchObject({ name: 'Acme', currency: 'PLN', trialEndsAt: '2026-11-10T00:00:00.000Z' })
  })

  it('returns no document for a missing company', async () => {
    expect(await readExportPage(db, 'nope', 'organization', null)).toEqual({ docs: [], next: null })
    expect(await readExportPage(db, 'nope', 'transactions', null)).toEqual({ docs: [], next: null })
  })

  it('never exports a derived collection through any export collection', async () => {
    await db.doc(`organizations/${ORG}/rollups/rollup1`).set({ total: 1 })
    for (const c of EXPORT_COLLECTIONS) {
      const { docs } = await readAll(c)
      expect(docs.map((d) => d.id)).not.toContain('rollup1')
    }
  })

  it('keeps a page under the byte cap yet always makes progress', async () => {
    const big = (n: number) => 'x'.repeat(n)
    await writeAll(db, [
      { path: `organizations/${ORG}/audit/a`, data: { note: big(950_000) } }, // alone over the cap: still one page of its own
      { path: `organizations/${ORG}/audit/b`, data: { note: big(400_000) } },
      { path: `organizations/${ORG}/audit/c`, data: { note: big(400_000) } },
      { path: `organizations/${ORG}/audit/d`, data: { note: big(400_000) } },
      { path: `organizations/${ORG}/audit/e`, data: { note: 'small' } },
    ])
    const { pages, docs } = await readAll('audit')
    expect(docs.map((d) => d.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    for (const p of pages) {
      expect(p.docs.length).toBeGreaterThanOrEqual(1)
      if (p.docs.length > 1) expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(EXPORT_PAGE_BYTES)
    }
    expect(pages.map((p) => p.docs.map((d) => d.id))).toEqual([['a'], ['b', 'c'], ['d', 'e']])
  })

  it('counts bytes, not characters', async () => {
    // 2 bytes per character: 3 x 250k characters = 1.5 MB, so two do not fit one page.
    const wide = 'ł'.repeat(250_000)
    await writeAll(db, ['a', 'b', 'c'].map((id) => ({ path: `organizations/${ORG}/audit/${id}`, data: { note: wide } })))
    const { pages } = await readAll('audit')
    expect(pages.map((p) => p.docs.length)).toEqual([1, 1, 1])
  })
})
