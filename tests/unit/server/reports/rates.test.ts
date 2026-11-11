import { describe, expect, it, vi } from 'vitest'
import { addDays } from '@/lib/domain/ledger/days'
import { rateKey } from '@/lib/domain/reports/reconcile'
import { FxError, type RateSnapshot } from '@/lib/server/fx/types'
import { MAX_RATE_LOOKUPS, quoteRates, RATE_CONCURRENCY } from '@/lib/server/reports/rates'

const snapshot = (from: string, to: string, date: string, rate: number): RateSnapshot => ({
  rate, from, to, requestedDate: date, rateDate: '2026-10-26', tableNo: '208/A/NBP/2026', source: 'NBP_A', final: true,
})

describe('quoteRates', () => {
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
    const book = await quoteRates(resolve, 'PLN', needs)
    expect(resolve).toHaveBeenCalledTimes(needs.length)
    expect(book.size).toBe(needs.length)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(RATE_CONCURRENCY)
  })

  it('refuses more distinct rates than MAX_RATE_LOOKUPS before asking NBP for any of them', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, 4.3))
    const needs = Array.from({ length: MAX_RATE_LOOKUPS + 1 }, (_, i) => ({ currency: 'EUR', date: addDays('2000-01-01', i) }))
    await expect(quoteRates(resolve, 'PLN', needs)).rejects.toMatchObject({ code: 'too_many_rates', cap: MAX_RATE_LOOKUPS })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('the same rate asked many times is one lookup, so it does not count against the cap', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, 4.3))
    const needs = Array.from({ length: MAX_RATE_LOOKUPS + 50 }, () => ({ currency: 'EUR', date: '2026-10-27' }))
    expect((await quoteRates(resolve, 'PLN', needs)).size).toBe(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('asks each needed rate once and keeps it by currency and day', async () => {
    const resolve = vi.fn(async (from: string, to: string, date: string): Promise<RateSnapshot> => snapshot(from, to, date, from === 'EUR' ? 4.3 : 4))
    const book = await quoteRates(resolve, 'PLN', [
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
    expect((await quoteRates(down, 'PLN', [{ currency: 'EUR', date: '2026-10-27' }])).size).toBe(0)
    const broken = vi.fn(async (): Promise<RateSnapshot> => {
      throw new Error('bug')
    })
    await expect(quoteRates(broken, 'PLN', [{ currency: 'EUR', date: '2026-10-27' }])).rejects.toThrow('bug')
  })
})
