import { describe, expect, it, vi } from 'vitest'
import { rateKey } from '@/lib/domain/reports/reconcile'
import { FxError, type RateSnapshot } from '@/lib/server/fx/types'
import { quoteRates } from '@/lib/server/reports/rates'

const snapshot = (from: string, to: string, date: string, rate: number): RateSnapshot => ({
  rate, from, to, requestedDate: date, rateDate: '2026-10-26', tableNo: '208/A/NBP/2026', source: 'NBP_A', final: true,
})

describe('quoteRates', () => {
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
