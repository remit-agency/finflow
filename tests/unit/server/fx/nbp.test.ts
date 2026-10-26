import { describe, expect, it, vi } from 'vitest'
import { fetchNbpTables } from '@/lib/server/fx/nbp'
import { FxError } from '@/lib/server/fx/types'

const body = [
  {
    table: 'A',
    no: '207/A/NBP/2026',
    effectiveDate: '2026-10-23',
    rates: [
      { currency: 'euro', code: 'EUR', mid: 4.4 },
      { currency: 'dolar amerykański', code: 'USD', mid: 3.9 },
    ],
  },
  {
    table: 'A',
    no: '206/A/NBP/2026',
    effectiveDate: '2026-10-22',
    rates: [{ currency: 'euro', code: 'EUR', mid: 4.3 }],
  },
]

const respond = (status: number, json?: unknown) =>
  vi.fn<(url: string, init?: unknown) => Promise<Response>>(
    async () => new Response(json === undefined ? 'x' : JSON.stringify(json), { status }),
  )

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof FxError ? e.code : 'other'
  }
  return 'none'
}

describe('fetchNbpTables', () => {
  it('requests table A for the range and returns ascending tables', async () => {
    const f = respond(200, body)
    const tables = await fetchNbpTables('2026-10-01', '2026-10-26', f)
    expect(f.mock.calls[0][0]).toBe('https://api.nbp.pl/api/exchangerates/tables/A/2026-10-01/2026-10-26/?format=json')
    expect(tables.map((t) => t.effectiveDate)).toEqual(['2026-10-22', '2026-10-23'])
    expect(tables[1]).toEqual({ no: '207/A/NBP/2026', effectiveDate: '2026-10-23', rates: { EUR: 4.4, USD: 3.9 } })
  })

  it('404 means no tables in the range', async () => {
    expect(await fetchNbpTables('2026-10-03', '2026-10-04', respond(404))).toEqual([])
  })

  it.each([400, 500, 503])('status %i is provider_unavailable', async (status) => {
    expect(await code(fetchNbpTables('2026-10-01', '2026-10-26', respond(status)))).toBe('provider_unavailable')
  })

  it('a network failure is provider_unavailable', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await code(fetchNbpTables('2026-10-01', '2026-10-26', f))).toBe('provider_unavailable')
  })

  it.each([
    ['not an array', { a: 1 }],
    ['a table without a date', [{ no: 'x', rates: [] }]],
    ['a bad date', [{ no: 'x', effectiveDate: '26-10-23', rates: [] }]],
    ['a rate without a code', [{ no: 'x', effectiveDate: '2026-10-23', rates: [{ mid: 4 }] }]],
    ['a lowercase code', [{ no: 'x', effectiveDate: '2026-10-23', rates: [{ code: 'eur', mid: 4 }] }]],
    ['a zero rate', [{ no: 'x', effectiveDate: '2026-10-23', rates: [{ code: 'EUR', mid: 0 }] }]],
    ['a string rate', [{ no: 'x', effectiveDate: '2026-10-23', rates: [{ code: 'EUR', mid: '4' }] }]],
  ])('rejects %s as provider_unavailable', async (_label, json) => {
    expect(await code(fetchNbpTables('2026-10-01', '2026-10-26', respond(200, json)))).toBe('provider_unavailable')
  })

  it('invalid JSON is provider_unavailable', async () => {
    const f = vi.fn(async () => new Response('<html>', { status: 200 }))
    expect(await code(fetchNbpTables('2026-10-01', '2026-10-26', f))).toBe('provider_unavailable')
  })
})
