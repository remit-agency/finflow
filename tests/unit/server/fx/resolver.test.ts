import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createResolver, type FxDeps } from '@/lib/server/fx/resolver'
import { round8 } from '@/lib/server/fx/rates'
import type { FxStore } from '@/lib/server/fx/store'
import { FxError, type MonthDoc, type NbpTable } from '@/lib/server/fx/types'
import { fakeNbp, fixtureTables, memoryStore } from '@/tests/unit/server/fx/helpers'

const TODAY = '2026-10-26'
// After NBP publishes the table of the day (about 12:00 Warsaw), so the clock agrees with TODAY.
const NOW = Date.parse('2026-10-26T12:30:00Z')
const HOUR = 3_600_000
const ALL = fixtureTables()
const table = (effectiveDate: string): NbpTable => {
  const t = ALL.find((x) => x.effectiveDate === effectiveDate)
  if (!t) throw new Error(`fixture has no table for ${effectiveDate}`)
  return t
}

function setup(opts: { tables?: NbpTable[]; today?: string; store?: FxStore; fetchTables?: FxDeps['fetchTables'] } = {}) {
  const today = opts.today ?? TODAY
  const nbp = fakeNbp(opts.tables ?? ALL, today)
  const mem = memoryStore()
  let clock = NOW
  const deps: FxDeps = {
    store: opts.store ?? mem.store,
    fetchTables: opts.fetchTables ?? nbp.fn,
    now: () => clock,
    today: () => today,
  }
  return {
    resolve: createResolver(deps),
    /** A resolver with empty in-memory caches over the same store, NBP and clock. */
    fresh: (override: Partial<FxDeps> = {}) => createResolver({ ...deps, ...override }),
    nbp,
    mem,
    advance: (ms: number) => (clock += ms),
  }
}

/** A cached month document as an earlier fetch would have left it. */
function cachedDoc(month: string, days: string[], over: Partial<MonthDoc> = {}): MonthDoc {
  return {
    month,
    tables: days.map(table),
    fetchedAt: NOW - 2 * HOUR,
    fetchedDay: TODAY,
    complete: false,
    ...over,
  }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof FxError ? e.code : 'other'
  }
  return 'none'
}

describe('rule: the table strictly before the day', () => {
  // expected = the last day NBP published before the requested day (verified against the fixtures)
  it.each([
    ['Monday takes Friday', '2026-10-19', '2026-10-16'],
    ['Tuesday takes Monday', '2026-10-20', '2026-10-19'],
    ['a Saturday takes Friday', '2026-10-17', '2026-10-16'],
    ['a Sunday takes Friday', '2026-10-18', '2026-10-16'],
    ['Easter Tuesday takes Good Friday', '2025-04-22', '2025-04-18'],
    ['the day after 11 November takes 10 November', '2025-11-12', '2025-11-10'],
    ['a Monday after a month change takes the last day of the previous month', '2025-11-03', '2025-10-31'],
    ['after Christmas takes 23 December', '2025-12-29', '2025-12-23'],
    ['2 January takes 31 December (year change)', '2026-01-02', '2025-12-31'],
    ['after Epiphany takes 5 January', '2026-01-07', '2026-01-05'],
    ['today takes the previous published day', '2026-10-26', '2026-10-23'],
  ])('%s', async (_label, day, expectedRateDate) => {
    const { resolve } = setup()
    const r = await resolve('EUR', 'PLN', day)
    expect(r.rateDate).toBe(expectedRateDate)
    expect(r.rate).toBe(round8(table(expectedRateDate).rates.EUR))
    expect(r.tableNo).toBe(table(expectedRateDate).no)
    expect(r.source).toBe('NBP_A')
    expect(r.requestedDate).toBe(day)
  })

  it('a future date takes the latest published table', async () => {
    const { resolve } = setup()
    expect((await resolve('EUR', 'PLN', '2026-12-01')).rateDate).toBe('2026-10-26')
  })
})

describe('currencies', () => {
  it('identical currencies give 1 without touching NBP', async () => {
    const { resolve, nbp } = setup()
    expect(await resolve('EUR', 'EUR', '2026-10-20')).toEqual({
      rate: 1,
      from: 'EUR',
      to: 'EUR',
      requestedDate: '2026-10-20',
      rateDate: '2026-10-20',
      tableNo: null,
      source: 'identity',
      final: true,
    })
    expect(nbp.calls).toHaveLength(0)
  })

  it('PLN -> EUR is the inverse and EUR -> USD goes through PLN', async () => {
    const { resolve } = setup()
    const t = table('2026-10-19')
    expect((await resolve('PLN', 'EUR', '2026-10-20')).rate).toBe(round8(1 / t.rates.EUR))
    expect((await resolve('EUR', 'USD', '2026-10-20')).rate).toBe(round8(t.rates.EUR / t.rates.USD))
  })

  it('a currency that is not in table A is unsupported_currency', async () => {
    const { resolve } = setup()
    expect(await codeOf(resolve('XXX', 'PLN', '2026-10-20'))).toBe('unsupported_currency')
  })
})

describe('validation', () => {
  it.each([
    ['lowercase code', 'eur', 'PLN', '2026-10-20'],
    ['long code', 'EURO', 'PLN', '2026-10-20'],
    ['bad day', 'EUR', 'PLN', '2026-02-30'],
    ['a date more than a year ahead', 'EUR', 'PLN', '2028-01-01'],
  ])('%s is invalid_params', async (_label, from, to, day) => {
    const { resolve } = setup()
    expect(await codeOf(resolve(from, to, day))).toBe('invalid_params')
  })

  it('a day with no table before it is no_rate_before', async () => {
    const { resolve } = setup()
    expect(await codeOf(resolve('EUR', 'PLN', '1999-05-05'))).toBe('no_rate_before')
  })
})

describe('cache', () => {
  it('a miss fetches the month once and stores it; a hit does not fetch', async () => {
    const { resolve, nbp, mem } = setup()
    await resolve('EUR', 'PLN', '2026-10-20')
    expect(nbp.calls).toEqual([['2026-10-01', '2026-10-26']])
    expect(mem.sets).toEqual(['2026-10'])
    await resolve('USD', 'PLN', '2026-10-21')
    expect(nbp.calls).toHaveLength(1)
  })

  it('a finished month is stored as complete and never fetched again', async () => {
    const { resolve, nbp, mem, advance } = setup()
    await resolve('EUR', 'PLN', '2025-04-22')
    expect(mem.docs.get('2025-04')?.complete).toBe(true)
    expect(nbp.calls).toEqual([['2025-04-01', '2025-04-30']])
    advance(1000 * HOUR)
    await resolve('EUR', 'PLN', '2025-04-23')
    expect(nbp.calls).toHaveLength(1)
  })

  it('the current month is stored as not complete and a later day refreshes it after an hour', async () => {
    const { resolve, nbp, mem, advance } = setup()
    await resolve('EUR', 'PLN', '2026-10-28')
    expect(mem.docs.get('2026-10')).toMatchObject({ complete: false, fetchedDay: TODAY, fetchedAt: NOW })
    advance(HOUR - 1)
    await resolve('EUR', 'PLN', '2026-10-28')
    expect(nbp.calls).toHaveLength(1)
    advance(2)
    await resolve('EUR', 'PLN', '2026-10-28')
    expect(nbp.calls).toHaveLength(2)
  })

  it('a day up to the fetch day never refetches, however old the fetch is', async () => {
    const { resolve, nbp, advance } = setup()
    await resolve('EUR', 'PLN', '2026-10-28')
    advance(5 * HOUR)
    await resolve('EUR', 'PLN', '2026-10-20')
    await resolve('EUR', 'PLN', TODAY)
    expect(nbp.calls).toHaveLength(1)
  })

  it('stores the fetch day with the month', async () => {
    const { resolve, mem } = setup()
    await resolve('EUR', 'PLN', '2025-04-22')
    expect(mem.docs.get('2025-04')).toMatchObject({ complete: true, fetchedDay: TODAY })
  })

  it('a finished month is kept in memory: the store is read once', async () => {
    const mem = memoryStore()
    const get = vi.fn(mem.store.get)
    const { resolve } = setup({ store: { get, set: mem.store.set } })
    await resolve('EUR', 'PLN', '2025-04-22')
    await resolve('USD', 'PLN', '2025-04-23')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('an unreadable cache is a miss, not an error', async () => {
    const mem = memoryStore()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { resolve, nbp } = setup({
      store: {
        get: async () => {
          throw new TypeError('firestore down with secrets')
        },
        set: mem.store.set,
      },
    })
    expect((await resolve('EUR', 'PLN', '2026-10-20')).rateDate).toBe('2026-10-19')
    expect(nbp.calls).toHaveLength(1)
    expect(err).toHaveBeenCalledWith('fx cache read failed', { name: 'TypeError' })
  })

  it('a month walk fetches the previous month when the day is early in the month', async () => {
    const { resolve, nbp } = setup()
    const r = await resolve('EUR', 'PLN', '2025-11-03')
    expect(r.rateDate).toBe('2025-10-31')
    expect(nbp.calls).toEqual([
      ['2025-11-01', '2025-11-30'],
      ['2025-10-01', '2025-10-31'],
    ])
  })

  it('a future month is never fetched (NBP would answer 400)', async () => {
    const { resolve, nbp } = setup()
    await resolve('EUR', 'PLN', '2027-03-15')
    expect(nbp.calls).toEqual([['2026-10-01', '2026-10-26']])
  })

  it('does not store an empty finished month and reports provider_unavailable', async () => {
    const { resolve, mem } = setup({ tables: [] })
    expect(await codeOf(resolve('EUR', 'PLN', '2025-04-22'))).toBe('provider_unavailable')
    expect(mem.sets).toHaveLength(0)
  })

  it('a month missing from the store is fetched again (by a resolver with empty memory)', async () => {
    const { resolve, fresh, nbp, mem } = setup()
    await resolve('EUR', 'PLN', '2025-04-22')
    mem.docs.delete('2025-04')
    await fresh()('EUR', 'PLN', '2025-04-22')
    expect(nbp.calls).toHaveLength(2)
  })
})

describe('clock: the day table is not published yet', () => {
  it('today and tomorrow take the last published table; a later fetch picks the new one up', async () => {
    const published = ALL.filter((t) => t.effectiveDate < TODAY)
    const { resolve, nbp, advance } = setup({ tables: published })
    expect((await resolve('EUR', 'PLN', TODAY)).rateDate).toBe('2026-10-23')
    expect((await resolve('EUR', 'PLN', '2026-10-27')).rateDate).toBe('2026-10-23')
    expect(nbp.calls).toHaveLength(1)

    published.push(table(TODAY)) // NBP publishes
    advance(2 * HOUR)
    expect((await resolve('EUR', 'PLN', '2026-10-27')).rateDate).toBe('2026-10-26')
    expect(nbp.calls).toHaveLength(2)
    // today's own answer never depended on today's table
    expect((await resolve('EUR', 'PLN', TODAY)).rateDate).toBe('2026-10-23')
    expect(nbp.calls).toHaveLength(2)
  })
})

describe('final', () => {
  it.each([
    ['a date after today is not final', '2026-10-27', false],
    ['a far future date is not final', '2027-03-01', false],
    ['today is final', TODAY, true],
    ['a past date is final', '2026-10-20', true],
  ])('%s', async (_label, day, final) => {
    const { resolve } = setup()
    expect((await resolve('EUR', 'PLN', day)).final).toBe(final)
  })

  it('identical currencies are final even for a future date', async () => {
    const { resolve } = setup()
    expect((await resolve('EUR', 'EUR', '2026-12-01')).final).toBe(true)
  })
})

describe('refreshed months are validated before they are stored', () => {
  const OCT = ['2026-10-16', '2026-10-19']

  it('an empty NBP reply never replaces a cached month (the reviewer scenario)', async () => {
    // October was cached on 20 October with 10-16 and 10-19; NBP now answers 404 (empty).
    const s = setup({ tables: [] })
    const doc = cachedDoc('2026-10', OCT, { fetchedDay: '2026-10-20' })
    s.mem.docs.set('2026-10', doc)
    expect((await s.resolve('EUR', 'PLN', '2026-10-20')).rateDate).toBe('2026-10-19')
    expect(s.mem.docs.get('2026-10')).toBe(doc)
    expect(s.mem.sets).toHaveLength(0)
  })

  it('a refresh that is forced and gets an empty reply fails without touching the cache', async () => {
    const s = setup({ tables: [] })
    const doc = cachedDoc('2026-10', OCT, { fetchedDay: '2026-10-20' })
    s.mem.docs.set('2026-10', doc)
    // 10-28 is after the fetch day, so the stale month cannot answer it and NBP is asked
    expect(await codeOf(s.resolve('EUR', 'PLN', '2026-10-28'))).toBe('provider_unavailable')
    expect(s.nbp.calls).toHaveLength(1)
    expect(s.mem.docs.get('2026-10')).toBe(doc)
    expect(s.mem.sets).toHaveLength(0)
  })

  it('a reply that lost a cached day is not stored', async () => {
    const s = setup({ tables: ALL.filter((t) => t.effectiveDate !== '2026-10-22') })
    const doc = cachedDoc('2026-10', ['2026-10-21', '2026-10-22', '2026-10-23'], { fetchedDay: '2026-10-23' })
    s.mem.docs.set('2026-10', doc)
    expect(await codeOf(s.resolve('EUR', 'PLN', '2026-10-28'))).toBe('provider_unavailable')
    expect(s.mem.docs.get('2026-10')).toBe(doc)
  })

  it('a reply with a gap in the table numbers is not stored', async () => {
    const s = setup({ tables: ALL.filter((t) => t.effectiveDate !== '2026-10-21') })
    expect(await codeOf(s.resolve('EUR', 'PLN', '2026-10-20'))).toBe('provider_unavailable')
    expect(s.mem.sets).toHaveLength(0)
  })
})

describe('shared work and the failure memo', () => {
  it('20 simultaneous resolves on an empty store make one NBP call and one store.set', async () => {
    const { resolve, nbp, mem } = setup()
    const results = await Promise.all(Array.from({ length: 20 }, () => resolve('EUR', 'PLN', '2026-10-20')))
    expect(new Set(results.map((r) => r.rateDate))).toEqual(new Set(['2026-10-19']))
    expect(nbp.calls).toHaveLength(1)
    expect(mem.sets).toEqual(['2026-10'])
  })

  it('simultaneous resolves share one failed NBP call', async () => {
    const fetchTables = vi.fn(async () => {
      throw new FxError('provider_unavailable')
    })
    const { resolve } = setup({ fetchTables })
    const codes = await Promise.all(Array.from({ length: 20 }, () => codeOf(resolve('EUR', 'PLN', '2026-10-20'))))
    expect(new Set(codes)).toEqual(new Set(['provider_unavailable']))
    expect(fetchTables).toHaveBeenCalledTimes(1)
  })

  it('after a failed fetch NBP is not called again for 30 seconds', async () => {
    let down = true
    const nbp = fakeNbp(ALL, TODAY)
    const fetchTables = vi.fn((a: string, b: string) => {
      if (down) throw new FxError('provider_unavailable')
      return nbp.fn(a, b)
    })
    const { resolve, advance } = setup({ fetchTables })
    expect(await codeOf(resolve('EUR', 'PLN', '2026-10-20'))).toBe('provider_unavailable')
    advance(29_000)
    expect(await codeOf(resolve('EUR', 'PLN', '2026-10-20'))).toBe('provider_unavailable')
    expect(fetchTables).toHaveBeenCalledTimes(1)

    down = false
    advance(2_000) // 31 s after the failure
    expect((await resolve('EUR', 'PLN', '2026-10-20')).rateDate).toBe('2026-10-19')
    expect(fetchTables).toHaveBeenCalledTimes(2)
  })

  it('a failed refresh is remembered for the month while days the cache can answer are still served', async () => {
    const s = setup()
    await s.resolve('EUR', 'PLN', '2026-10-20')
    s.advance(2 * HOUR)
    let calls = 0
    const down = async (): Promise<NbpTable[]> => {
      calls++
      throw new FxError('provider_unavailable')
    }
    const resolve = s.fresh({ fetchTables: down })
    expect(await codeOf(resolve('EUR', 'PLN', '2026-10-28'))).toBe('provider_unavailable')
    expect(await codeOf(resolve('EUR', 'PLN', '2026-10-28'))).toBe('provider_unavailable')
    expect(calls).toBe(1)
    // a day the cache can answer is still served while NBP is being avoided
    expect((await resolve('EUR', 'PLN', '2026-10-21')).rateDate).toBe('2026-10-20')
  })
})

describe('NBP outage', () => {
  const downCalls: string[] = []
  beforeEach(() => {
    downCalls.length = 0
  })
  const down = async (from: string): Promise<NbpTable[]> => {
    downCalls.push(from)
    throw new FxError('provider_unavailable')
  }

  /** The current month cached earlier today with tables up to 10-23, then two hours pass. */
  async function cachedEarlierToday() {
    const s = setup({ tables: ALL.filter((t) => t.effectiveDate <= '2026-10-23') })
    await s.resolve('EUR', 'PLN', '2026-10-20')
    s.advance(2 * HOUR)
    downCalls.length = 0
    return s
  }

  it('serves today from a month fetched earlier today: every table before today is in it', async () => {
    const s = await cachedEarlierToday()
    const resolve = s.fresh({ fetchTables: down })
    expect((await resolve('EUR', 'PLN', TODAY)).rateDate).toBe('2026-10-23')
    expect(downCalls).toHaveLength(0)
  })

  it('fails for a future day: a newer table may exist upstream', async () => {
    const s = await cachedEarlierToday()
    const resolve = s.fresh({ fetchTables: down })
    expect(await codeOf(resolve('EUR', 'PLN', '2026-10-28'))).toBe('provider_unavailable')
    expect(downCalls).toHaveLength(1)
  })

  it('serves a stale month fetched on an earlier day when it holds a table on or after the day', async () => {
    const s = setup()
    s.mem.docs.set('2026-10', cachedDoc('2026-10', ['2026-10-16', '2026-10-19', '2026-10-20'], { fetchedDay: '2026-10-20' }))
    const resolve = s.fresh({ fetchTables: down })
    expect((await resolve('EUR', 'PLN', '2026-10-20')).rateDate).toBe('2026-10-19')
  })

  it('fails during a month walk when the previous month is not cached', async () => {
    const s = setup()
    // 2025-11 is cached but has no table before 2025-11-03; 2025-10 is not cached
    s.mem.docs.set('2025-11', cachedDoc('2025-11', ['2025-11-03', '2025-11-04'], { fetchedDay: '2025-11-30', complete: true }))
    const resolve = s.fresh({ fetchTables: down })
    expect(await codeOf(resolve('EUR', 'PLN', '2025-11-03'))).toBe('provider_unavailable')
    expect(downCalls).toContain('2025-10-01')
  })

  it('a failed cache write still returns the rate', async () => {
    const s = setup()
    const resolve = createResolver({
      store: { get: s.mem.store.get, set: async () => { throw new Error('firestore down') } },
      fetchTables: s.nbp.fn,
      now: () => NOW,
      today: () => TODAY,
    })
    expect((await resolve('EUR', 'PLN', '2026-10-20')).rateDate).toBe('2026-10-19')
  })
})

// Deterministic PRNG so a failure is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('properties', () => {
  const CODES = ['PLN', 'EUR', 'USD', 'UAH', 'GBP']
  // From the 8th on, the previous month is never needed (fixtures only cover some months).
  const DAYS = ALL.map((t) => t.effectiveDate).filter((d) => d.slice(8) >= '08' && d <= TODAY)

  it('A->B times B->A is 1 and A->C equals A->B times B->C (within rounding)', async () => {
    const { resolve } = setup()
    const rnd = mulberry32(42)
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
    for (let i = 0; i < 150; i++) {
      const [a, b, c] = [pick(CODES), pick(CODES), pick(CODES)]
      const day = pick(DAYS)
      const ab = (await resolve(a, b, day)).rate
      const ba = (await resolve(b, a, day)).rate
      const bc = (await resolve(b, c, day)).rate
      const ac = (await resolve(a, c, day)).rate
      expect(Math.abs(ab * ba - 1)).toBeLessThan(1e-5)
      expect(Math.abs(ab * bc - ac) / ac).toBeLessThan(1e-5)
    }
  })

  it('moving the day later never selects an earlier table', async () => {
    const { resolve } = setup()
    let last = ''
    for (let d = new Date('2025-11-01T00:00:00Z'); d <= new Date('2026-01-31T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const r = await resolve('EUR', 'PLN', d.toISOString().slice(0, 10))
      expect(r.rateDate < r.requestedDate).toBe(true)
      expect(r.rateDate >= last).toBe(true)
      last = r.rateDate
    }
  })
})
