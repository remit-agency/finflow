import { describe, expect, it } from 'vitest'
import { runChunked } from '@/lib/api/journal-bulk'
import type { BulkOutcome } from '@/lib/domain/journal/bulk-input'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`)
const okAll = async (chunk: string[]): Promise<BulkOutcome[]> => chunk.map((id) => ({ id, ok: true as const }))

describe('runChunked', () => {
  it('sends chunks of at most 25, in order, and reports progress', async () => {
    const sizes: number[] = []
    const progress: [number, number][] = []
    const { outcomes, stopped } = await runChunked(ids(60), async (chunk) => {
      sizes.push(chunk.length)
      return okAll(chunk)
    }, { onProgress: (done, total) => progress.push([done, total]) })
    expect(sizes).toEqual([25, 25, 10])
    expect(outcomes).toHaveLength(60)
    expect(stopped).toBe(false)
    expect(progress).toEqual([[25, 60], [50, 60], [60, 60]])
  })
  it('stops between chunks when aborted and keeps what was done', async () => {
    const ac = new AbortController()
    const { outcomes, stopped } = await runChunked(ids(60), async (chunk) => {
      ac.abort()
      return okAll(chunk)
    }, { signal: ac.signal })
    expect(outcomes).toHaveLength(25)
    expect(stopped).toBe(true)
  })
  it('passes a refusal through as that row\'s outcome', async () => {
    const { outcomes } = await runChunked(['a', 'b'], async (chunk) => chunk.map((id) => (id === 'b' ? { id, ok: false as const, code: 'future_actual' } : { id, ok: true as const })))
    expect(outcomes).toEqual([{ id: 'a', ok: true }, { id: 'b', ok: false, code: 'future_actual' }])
  })
})
