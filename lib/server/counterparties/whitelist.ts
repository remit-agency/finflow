import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { parseWhitelistBody, type WhitelistLookup } from '@/lib/domain/counterparties/whitelist'

const DEFAULT_BASE = 'https://wl-api.mf.gov.pl'
const TIMEOUT_MS = 8000

export interface WhitelistClientOptions {
  fetch?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
}

/**
 * Asks the MF white list (public API, no key) about a NIP on `day` (`YYYY-MM-DD`, the Warsaw day). One retry after
 * a network error or timeout; an HTTP error or an unreadable body is not retried. Every failure is
 * `lookup_unavailable`, and the reply text is never logged or passed on. `WL_API_BASE` exists for tests (a stub).
 */
export async function lookupNip(nip: string, day: string, options: WhitelistClientOptions = {}): Promise<WhitelistLookup> {
  const doFetch = options.fetch ?? fetch
  const base = (options.baseUrl ?? process.env.WL_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, '')
  const url = `${base}/api/search/nip/${encodeURIComponent(nip)}?date=${encodeURIComponent(day)}`

  let res: Response | undefined
  for (let attempt = 0; attempt < 2 && res === undefined; attempt++) {
    try {
      res = await doFetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch {
      // Network error or timeout: try once more.
    }
  }
  if (res === undefined || !res.ok) throw new CounterpartyError('lookup_unavailable')

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new CounterpartyError('lookup_unavailable')
  }
  return parseWhitelistBody(body)
}
