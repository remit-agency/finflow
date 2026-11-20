import { describe, expect, it } from 'vitest'
import { boundIdentityText, finmapIdentity, planFinmap } from '@/lib/domain/import/finmap/plan'
import type { FinmapExisting, FinmapOptions, FinmapRow } from '@/lib/domain/import/finmap/types'

// Synthetic rows only: every name, comment and amount here is made up for the test.
const row = (over: Partial<FinmapRow> = {}): FinmapRow => ({
  line: 2, paymentDay: '2026-10-05', timeText: '46000.5', minute: 720, amountMinor: 1000,
  from: 'Konto A', to: null, category: null, subcategory: null, counterparty: null,
  hasSubcounterparty: false, hasProject: false, tags: [], comment: null, period: null,
  ...over,
})
const existing: FinmapExisting = { companyCurrency: 'PLN', accounts: [], categories: [], counterparties: [], tags: [] }
const opts: FinmapOptions = { includePlanned: false, pairTransfers: true, today: '2026-10-20' }

describe('boundIdentityText', () => {
  it('keeps a string of at most 64 characters as it is', () => {
    const s = 'x'.repeat(64)
    expect(boundIdentityText(s)).toBe(s)
    expect(boundIdentityText('')).toBe('')
  })

  it('shortens a longer string to its first 40 characters, its length and a hash, at most 64 characters', () => {
    const s = 'a'.repeat(40) + 'b'.repeat(100)
    const out = boundIdentityText(s)
    expect(out).toMatch(/^a{40}#140#[0-9a-z]+$/)
    expect(out.length).toBeLessThanOrEqual(64)
  })

  it('is deterministic: the same input gives the same output', () => {
    const s = 'q'.repeat(300)
    expect(boundIdentityText(s)).toBe(boundIdentityText(s))
  })

  it('tells apart two long strings with the same first 40 characters and the same length', () => {
    const a = 'a'.repeat(40) + 'b'.repeat(100)
    const b = 'a'.repeat(40) + 'c'.repeat(100)
    expect(a.length).toBe(b.length)
    expect(boundIdentityText(a)).not.toBe(boundIdentityText(b))
  })

  it('counts characters by code point: 64 emoji stay as they are, 65 are shortened', () => {
    expect(boundIdentityText('😀'.repeat(64))).toBe('😀'.repeat(64))
    expect(boundIdentityText('😀'.repeat(65))).toMatch(/^😀{40}#65#[0-9a-z]+$/u)
  })
})

describe('finmapIdentity with long values', () => {
  it('every identity string of an operation with a 5 000-character comment and long tags is at most 64 characters', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `tag number ${i} ${'z'.repeat(40)}`)
    const identity = finmapIdentity(row({ comment: 'k'.repeat(5000), counterparty: 'p'.repeat(3000), tags }))
    expect(identity).toHaveLength(8)
    for (const s of identity) expect(s.length).toBeLessThanOrEqual(64)
  })

  it('a transfer of two long rows keeps its 17 strings, each at most 64 characters', () => {
    const plan = planFinmap(
      [
        row({ line: 2, from: 'Konto A', to: null, comment: 'c'.repeat(5000), tags: Array.from({ length: 30 }, (_, i) => `t${i}${'y'.repeat(60)}`) }),
        row({ line: 3, from: null, to: 'Konto B', comment: 'd'.repeat(5000) }),
      ],
      existing,
      opts,
    )
    expect(plan.operations).toHaveLength(1)
    const identity = plan.operations[0].identity
    expect(identity).toHaveLength(17)
    expect(identity[8]).toBe('+')
    for (const s of identity) expect(s.length).toBeLessThanOrEqual(64)
  })

  it('two rows whose long comments share their first 40 characters and length get different identities', () => {
    const a = finmapIdentity(row({ comment: 'p'.repeat(40) + '1'.repeat(200) }))
    const b = finmapIdentity(row({ comment: 'p'.repeat(40) + '2'.repeat(200) }))
    expect(a).not.toEqual(b)
    expect(a.filter((_, i) => i !== 6)).toEqual(b.filter((_, i) => i !== 6))
  })

  it('leaves the identity of short values exactly as before', () => {
    expect(finmapIdentity(row({ category: 'Transport', subcategory: 'Paliwo', counterparty: 'Orlen', comment: 'Baku', tags: ['B', 'a'] }))).toEqual([
      '46000.5', '1000', 'expense', 'transport', 'paliwo', 'orlen', 'baku', 'a|b',
    ])
  })
})
