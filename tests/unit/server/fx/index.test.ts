import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureTables } from '@/tests/unit/server/fx/helpers'

// The wiring under test: resolveRate -> Firestore store (tiny in-memory Admin db) -> NBP over fetch.
const fake = vi.hoisted(() => ({ docs: new Map<string, unknown>() }))

vi.mock('@/lib/server/firebase-admin', () => ({
  getAdmin: () => ({
    db: {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => ({ exists: fake.docs.has(`${name}/${id}`), data: () => fake.docs.get(`${name}/${id}`) }),
          set: async (value: unknown) => {
            fake.docs.set(`${name}/${id}`, value)
          },
        }),
      }),
    },
  }),
}))

const NBP_URL = /\/tables\/A\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\/\?format=json$/

/** Answers NBP URLs from the recorded fixtures in the NBP response shape (404 when nothing matches). */
function stubNbp() {
  const tables = fixtureTables()
  const fetchMock = vi.fn(async (url: string) => {
    const m = NBP_URL.exec(url)
    if (!m) return new Response('unexpected url', { status: 500 })
    const found = tables.filter((t) => t.effectiveDate >= m[1] && t.effectiveDate <= m[2])
    if (found.length === 0) return new Response('404 NotFound - Not Found', { status: 404 })
    const body = found.map((t) => ({
      table: 'A',
      no: t.no,
      effectiveDate: t.effectiveDate,
      rates: Object.entries(t.rates).map(([code, mid]) => ({ currency: code, code, mid })),
    }))
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function freshModule() {
  vi.resetModules() // a new module-level resolver, as in a new server process
  return import('@/lib/server/fx')
}

describe('resolveRate wiring', () => {
  beforeEach(() => {
    fake.docs.clear()
    // Only Date is faked: the NBP client's AbortSignal.timeout keeps real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T12:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('resolves through NBP, stores the month under fxTables/2026-10 and then serves from cache', async () => {
    const fetchMock = stubNbp()
    const { resolveRate } = await freshModule()

    const first = await resolveRate('EUR', 'PLN', '2026-10-20')
    expect(first).toMatchObject({ rateDate: '2026-10-19', source: 'NBP_A', final: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/2026-10-01/2026-10-26/')
    expect(fake.docs.get('fxTables/2026-10')).toMatchObject({
      month: '2026-10',
      fetchedDay: '2026-10-26',
      complete: false,
    })

    const second = await resolveRate('EUR', 'PLN', '2026-10-20')
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('marks a date after today as not final', async () => {
    stubNbp()
    const { resolveRate } = await freshModule()
    expect(await resolveRate('EUR', 'PLN', '2026-10-27')).toMatchObject({ rateDate: '2026-10-26', final: false })
  })

  it('builds the resolver once: a finished month stays in memory across calls', async () => {
    const fetchMock = stubNbp()
    const { resolveRate } = await freshModule()

    await resolveRate('EUR', 'PLN', '2025-04-22')
    expect(fake.docs.get('fxTables/2025-04')).toMatchObject({ complete: true })
    fake.docs.clear() // the store no longer has it, the process still does
    expect((await resolveRate('USD', 'PLN', '2025-04-23')).rateDate).toBe('2025-04-22')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
