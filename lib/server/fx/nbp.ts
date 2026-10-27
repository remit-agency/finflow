import 'server-only'
import { isDay } from '@/lib/domain/ledger/days'
import { FxError, type NbpTable } from '@/lib/server/fx/types'

const BASE = 'https://api.nbp.pl/api/exchangerates/tables/A'
const TIMEOUT_MS = 8000

type FetchLike = (url: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<Response>

function parseTables(json: unknown, fromDay: string, toDay: string): NbpTable[] {
  if (!Array.isArray(json)) throw new FxError('provider_unavailable')
  const seen = new Set<string>()
  const tables = json.map((raw): NbpTable => {
    if (typeof raw !== 'object' || raw === null) throw new FxError('provider_unavailable')
    const r = raw as Record<string, unknown>
    if (r.table !== 'A' || typeof r.no !== 'string' || !isDay(r.effectiveDate) || !Array.isArray(r.rates)) {
      throw new FxError('provider_unavailable')
    }
    // A table outside the requested range, or a day listed twice, means the reply is not what we asked for.
    if (r.effectiveDate < fromDay || r.effectiveDate > toDay || seen.has(r.effectiveDate)) {
      throw new FxError('provider_unavailable')
    }
    seen.add(r.effectiveDate)
    const rates: Record<string, number> = {}
    for (const item of r.rates) {
      const it = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
      if (typeof it.code !== 'string' || !/^[A-Z]{3}$/.test(it.code)) throw new FxError('provider_unavailable')
      if (typeof it.mid !== 'number' || !Number.isFinite(it.mid) || it.mid <= 0) throw new FxError('provider_unavailable')
      rates[it.code] = it.mid
    }
    return { no: r.no, effectiveDate: r.effectiveDate, rates }
  })
  return tables.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0))
}

/**
 * NBP table A for [fromDay, toDay] (at most 93 days, not in the future). 404 means no table was
 * published in the range. Every other failure is `provider_unavailable`; the NBP text never
 * reaches the caller.
 */
export async function fetchNbpTables(
  fromDay: string,
  toDay: string,
  fetchImpl: FetchLike = fetch,
): Promise<NbpTable[]> {
  let res: Response
  try {
    res = await fetchImpl(`${BASE}/${fromDay}/${toDay}/?format=json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    throw new FxError('provider_unavailable')
  }
  if (res.status === 404) return []
  if (!res.ok) throw new FxError('provider_unavailable')
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new FxError('provider_unavailable')
  }
  return parseTables(json, fromDay, toDay)
}
