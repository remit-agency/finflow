import { filtersToParams, type JournalFilters } from '@/lib/domain/journal/filter'
import type { JournalPage } from '@/lib/domain/journal/types'
import { readApiError } from './ledger-client'

export const PAGE_SIZE = 50

/** One page of the journal for the filters; `cursor` is the `next` of the previous page. */
export async function fetchJournalPage(
  orgId: string,
  filters: JournalFilters,
  cursor: string | null,
  opts: { signal?: AbortSignal; limit?: number } = {},
): Promise<JournalPage> {
  const params = filtersToParams(filters)
  if (cursor) params.set('cursor', cursor)
  params.set('limit', String(opts.limit ?? PAGE_SIZE))
  const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/journal?${params}`, { credentials: 'same-origin', signal: opts.signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as JournalPage
}
