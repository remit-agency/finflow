import { describe, expect, it } from 'vitest'
import { firestoreFxStore, parseMonthDoc } from '@/lib/server/fx/store'
import type { MonthDoc } from '@/lib/server/fx/types'

const DOC: MonthDoc = {
  month: '2026-10',
  tables: [{ no: '207/A/NBP/2026', effectiveDate: '2026-10-23', rates: { EUR: 4.4 } }],
  fetchedAt: 1_700_000_000_000,
  fetchedDay: '2026-10-26',
  complete: false,
}

function fakeDb() {
  const data = new Map<string, unknown>()
  return {
    data,
    db: {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => ({ exists: data.has(`${name}/${id}`), data: () => data.get(`${name}/${id}`) }),
          set: async (value: unknown) => {
            data.set(`${name}/${id}`, value)
          },
        }),
      }),
    },
  }
}

describe('parseMonthDoc', () => {
  it('accepts a well-formed document', () => expect(parseMonthDoc(DOC, '2026-10')).toEqual(DOC))
  it.each([
    ['wrong month', { ...DOC, month: '2026-09' }],
    ['no tables array', { ...DOC, tables: 'x' }],
    ['a table with a bad date', { ...DOC, tables: [{ no: 'x', effectiveDate: 'nope', rates: {} }] }],
    ['a bad rate', { ...DOC, tables: [{ no: 'x', effectiveDate: '2026-10-23', rates: { EUR: 'a' } }] }],
    ['no fetchedAt', { ...DOC, fetchedAt: undefined }],
    ['no fetchedDay', { ...DOC, fetchedDay: undefined }],
    ['a fetchedDay that is not a real day', { ...DOC, fetchedDay: '2026-02-30' }],
    ['no complete flag', { ...DOC, complete: 'yes' }],
    ['null', null],
  ])('rejects %s', (_label, value) => expect(parseMonthDoc(value, '2026-10')).toBeNull())
})

describe('firestoreFxStore', () => {
  it('returns null for a missing month', async () => {
    expect(await firestoreFxStore(fakeDb().db).get('2026-10')).toBeNull()
  })

  it('round-trips a month document under fxTables/{month}', async () => {
    const { db, data } = fakeDb()
    const store = firestoreFxStore(db)
    await store.set(DOC)
    expect(data.has('fxTables/2026-10')).toBe(true)
    expect(await store.get('2026-10')).toEqual(DOC)
  })

  it('treats a corrupt stored document as a miss', async () => {
    const { db, data } = fakeDb()
    data.set('fxTables/2026-10', { month: '2026-10', tables: 'garbage' })
    expect(await firestoreFxStore(db).get('2026-10')).toBeNull()
  })
})
