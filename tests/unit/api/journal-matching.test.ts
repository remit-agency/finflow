import { describe, expect, it, vi } from 'vitest'
import { collectMatching, SELECT_ALL_LIMIT } from '@/lib/api/journal-matching'
import { EMPTY_FILTERS } from '@/lib/domain/journal/filter'
import type { JournalPage } from '@/lib/domain/journal/types'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const row = (n: number) => ({ tx: { id: `t${n}` } as LedgerTransaction, balanceAfterMinor: null })
const pages = (counts: number[]): ((cursor: string | null) => Promise<JournalPage>) => {
  let n = 0
  return vi.fn(async (cursor: string | null) => {
    const i = cursor === null ? 0 : Number(cursor)
    const rows = Array.from({ length: counts[i] ?? 0 }, () => row(n++))
    return { rows, next: i + 1 < counts.length ? String(i + 1) : null }
  })
}

describe('collectMatching', () => {
  it('takes every row when fewer than the limit match', async () => {
    const out = await collectMatching('o', EMPTY_FILTERS, { fetchPage: pages([100, 100, 30]) })
    expect(out.rows).toHaveLength(230)
    expect(out.limitReached).toBe(false)
  })

  it('walks through empty pages that carry a cursor', async () => {
    const out = await collectMatching('o', EMPTY_FILTERS, { fetchPage: pages([0, 0, 5]) })
    expect(out.rows).toHaveLength(5)
    expect(out.limitReached).toBe(false)
  })

  it('takes exactly the limit and does not claim more when the rows end there', async () => {
    const out = await collectMatching('o', EMPTY_FILTERS, { fetchPage: pages(Array(10).fill(100)) })
    expect(out.rows).toHaveLength(SELECT_ALL_LIMIT)
    expect(out.limitReached).toBe(false)
  })

  it('takes the first rows and says so when more than the limit match', async () => {
    const out = await collectMatching('o', EMPTY_FILTERS, { fetchPage: pages(Array(12).fill(100)) })
    expect(out.rows).toHaveLength(SELECT_ALL_LIMIT)
    expect(out.rows[0].id).toBe('t0')
    expect(out.limitReached).toBe(true)
  })
})
