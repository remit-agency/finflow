import { describe, expect, it } from 'vitest'
import { createResolver } from '@/lib/server/fx/resolver'
import { round8 } from '@/lib/server/fx/rates'
import { FxError, type NbpTable } from '@/lib/server/fx/types'
import { fakeNbp, fixtureTables, memoryStore } from '@/tests/unit/server/fx/helpers'

const TODAY = '2026-10-26'
const NOW = Date.parse('2026-10-26T10:00:00Z')
const HOUR = 3_600_000
const ALL = fixtureTables()
const table = (effectiveDate: string): NbpTable => {
  const t = ALL.find((x) => x.effectiveDate === effectiveDate)
  if (!t) throw new Error(`fixture has no table for ${effectiveDate}`)
  return t
}

function setup(opts: { tables?: NbpTable[]; now?: () => number; today?: string } = {}) {
  const today = opts.today ?? TODAY
  const nbp = fakeNbp(opts.tables ?? ALL, today)
  const mem = memoryStore()
  let clock = NOW
  const resolve = createResolver({
    store: mem.store,
    fetchTables: nbp.fn,
    now: opts.now ?? (() => clock),
    today: () => today,
  })
  return { resolve, nbp, mem, advance: (ms: number) => (clock += ms) }
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

  it('the current month is stored as not complete and refreshed after an hour', async () => {
    const { resolve, nbp, mem, advance } = setup()
    await resolve('EUR', 'PLN', '2026-10-20')
    expect(mem.docs.get('2026-10')?.complete).toBe(false)
    advance(HOUR - 1)
    await resolve('EUR', 'PLN', '2026-10-20')
    expect(nbp.calls).toHaveLength(1)
    advance(2)
    await resolve('EUR', 'PLN', '2026-10-20')
    expect(nbp.calls).toHaveLength(2)
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

  it('a month missing from the store is fetched again', async () => {
    const { resolve, nbp, mem } = setup()
    await resolve('EUR', 'PLN', '2025-04-22')
    mem.docs.delete('2025-04')
    await resolve('EUR', 'PLN', '2025-04-22')
    expect(nbp.calls).toHaveLength(2)
  })
})

describe('NBP outage', () => {
  async function stale() {
    const s = setup()
    await s.resolve('EUR', 'PLN', '2026-10-20') // cache the current month
    s.advance(2 * HOUR) // stale
    return s
  }
  const down = async () => {
    throw new FxError('provider_unavailable')
  }

  it('serves a stale month when it already holds a table on or after the day (result is certain)', async () => {
    const s = await stale()
    const resolve = createResolver({ store: s.mem.store, fetchTables: down, now: () => NOW + 2 * HOUR, today: () => TODAY })
    expect((await resolve('EUR', 'PLN', '2026-10-20')).rateDate).toBe('2026-10-19')
  })

  it('fails when the stale month could be missing a newer table', async () => {
    const s = await stale()
    const resolve = createResolver({ store: s.mem.store, fetchTables: down, now: () => NOW + 2 * HOUR, today: () => TODAY })
    // the cached month ends on 2026-10-26; a day after that may have a newer table upstream
    expect(await codeOf(resolve('EUR', 'PLN', '2026-10-27'))).toBe('provider_unavailable')
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
