import { describe, expect, it, vi } from 'vitest'
import { addDays } from '@/lib/domain/ledger/days'
import { rateKey } from '@/lib/domain/reports/reconcile'
import { FxError, type RateSnapshot } from '@/lib/server/fx/types'
import { quoteRates, RATE_CONCURRENCY } from '@/lib/server/reports/rates'
import { MAX_RATE_MONTHS } from '@/lib/domain/reports/types'

const snapshot = (from: string, to: string, date: string, rate: number): RateSnapshot => ({
  rate, from, to, requestedDate: date, rateDate: '2026-10-26', tableNo: '208/A/NBP/2026', source: 'NBP_A', final: true,
})
/** The 15th of the i-th month from January 2000: one distinct NBP month table each. */
const monthNeed = (i: number, currency = 'EUR') => ({ currency, date: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-15` })

describe('quoteRates', () => {
  it('a period needing more NBP months than MAX_RATE_MONTHS is not refused: the rates of the months past the bound are left unrequested', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, 4.3))
    const needs = Array.from({ length: MAX_RATE_MONTHS + 1 }, (_, i) => monthNeed(i))
    const { book, unrequested } = await quoteRates(resolve, 'PLN', needs)
    expect(resolve).toHaveBeenCalledTimes(MAX_RATE_MONTHS)
    expect(book.size).toBe(MAX_RATE_MONTHS)
    expect(book.has(rateKey('EUR', needs[MAX_RATE_MONTHS - 1].date))).toBe(true)
    expect(book.has(rateKey('EUR', needs[MAX_RATE_MONTHS].date))).toBe(false)
    expect(unrequested).toEqual([needs[MAX_RATE_MONTHS]])
  })

  it('the bound counts NBP month tables, not days: many days of the same months are all asked', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, 4.3))
    const needs = Array.from({ length: 3 * 28 }, (_, i) => ({ currency: ['EUR', 'USD', 'GBP'][i % 3], date: `2026-10-${String((Math.floor(i / 3) % 28) + 1).padStart(2, '0')}` }))
    const { book, unrequested } = await quoteRates(resolve, 'PLN', needs)
    expect(book.size).toBe(3 * 28)
    expect(unrequested).toEqual([])
  })

  it('a day that is the 1st needs the table of the month before it (the resolver reads that month first)', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, 4.3))
    // One month of tables allowed: the 1st of October and the 15th of September both need the September table.
    const { book, unrequested } = await quoteRates(
      resolve,
      'PLN',
      [
        { currency: 'EUR', date: '2026-10-01' },
        { currency: 'EUR', date: '2026-09-15' },
      ],
      1,
    )
    expect(book.size).toBe(2)
    expect(unrequested).toEqual([])
  })

  it('asks NBP for at most RATE_CONCURRENCY rates at a time (a report of a long period is not a burst of requests)', async () => {
    let inFlight = 0
    let peak = 0
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((done) => setTimeout(done, 1))
      inFlight--
      return snapshot(from, to, date, 4.3)
    })
    const needs = Array.from({ length: 3 * RATE_CONCURRENCY + 1 }, (_, i) => ({ currency: 'EUR', date: addDays('2026-10-01', i) }))
    const { book } = await quoteRates(resolve, 'PLN', needs)
    expect(resolve).toHaveBeenCalledTimes(needs.length)
    expect(book.size).toBe(needs.length)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(RATE_CONCURRENCY)
  })

  it('the same rate asked many times is one lookup', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, 4.3))
    const needs = Array.from({ length: 500 }, () => ({ currency: 'EUR', date: '2026-10-27' }))
    expect((await quoteRates(resolve, 'PLN', needs)).book.size).toBe(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('asks each needed rate once and keeps it by currency and day', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, from === 'EUR' ? 4.3 : 4))
    const { book } = await quoteRates(resolve, 'PLN', [
      { currency: 'EUR', date: '2026-10-27' },
      { currency: 'USD', date: '2026-10-27' },
      { currency: 'EUR', date: '2026-10-27' },
    ])
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(book.get(rateKey('EUR', '2026-10-27'))).toEqual({ rate: 4.3, rateDate: '2026-10-26', tableNo: '208/A/NBP/2026', final: true })
    expect(book.size).toBe(2)
  })

  it('a rate NBP cannot give is left out (the reconciliation names it); any other failure is thrown', async () => {
    const down = vi.fn(async (): Promise<RateSnapshot> => {
      throw new FxError('provider_unavailable')
    })
    expect((await quoteRates(down, 'PLN', [{ currency: 'EUR', date: '2026-10-27' }])).book.size).toBe(0)
    const broken = vi.fn(async (): Promise<RateSnapshot> => {
      throw new Error('bug')
    })
    await expect(quoteRates(broken, 'PLN', [{ currency: 'EUR', date: '2026-10-27' }])).rejects.toThrow('bug')
  })
})
