import { Timestamp } from 'firebase-admin/firestore'
import { describe, expect, it } from 'vitest'
import { importView, parseImportDoc } from '@/lib/server/imports/types'

/** A document as S14 wrote it: no kind, no fit targets, no entity counts. */
const legacy = () => ({
  schemaVersion: 1,
  fileName: 'wyciag.sta',
  accountIds: ['a1'],
  createdAt: Timestamp.fromDate(new Date('2026-11-20T10:00:00Z')),
  createdBy: 'u1',
  period: { from: '2026-10-01', to: '2026-10-31' },
  counts: { created: 3, skipped: 1, refused: 0 },
  statements: [{ source: 'PL00', accountId: 'a1', from: '2026-10-01', to: '2026-10-31' }],
  fit: { a1: 'no' },
  status: 'applied',
  undo: { deleted: 0, kept: 0 },
})

describe('parseImportDoc (S14b additions)', () => {
  it('reads a document written before the Finmap import as an MT940 import with no targets and zero entities', () => {
    const doc = parseImportDoc(legacy())
    expect(doc).not.toBeNull()
    expect(doc?.kind).toBe('mt940')
    expect(doc?.fitTargets).toEqual({})
    expect(doc?.entities).toEqual({ accounts: 0, categories: 0, counterparties: 0, tags: 0 })
  })

  it('keeps the kind, the fit targets and the entity counts of a Finmap document', () => {
    const doc = parseImportDoc({
      ...legacy(),
      kind: 'finmap',
      fitTargets: { a1: 125_050, a2: -300 },
      entities: { accounts: 2, categories: 5, counterparties: 7, tags: 1 },
    })
    expect(doc?.kind).toBe('finmap')
    expect(doc?.fitTargets).toEqual({ a1: 125_050, a2: -300 })
    expect(doc?.entities).toEqual({ accounts: 2, categories: 5, counterparties: 7, tags: 1 })
  })

  it('refuses an unknown kind', () => {
    expect(parseImportDoc({ ...legacy(), kind: 'csv' })).toBeNull()
    expect(parseImportDoc({ ...legacy(), kind: 1 })).toBeNull()
  })

  it('refuses fit targets that are not safe minor amounts within the ledger range', () => {
    expect(parseImportDoc({ ...legacy(), fitTargets: { a1: '100' } })).toBeNull()
    expect(parseImportDoc({ ...legacy(), fitTargets: { a1: 1.5 } })).toBeNull()
    expect(parseImportDoc({ ...legacy(), fitTargets: { a1: 10 ** 14 } })).toBeNull()
    expect(parseImportDoc({ ...legacy(), fitTargets: [] })).toBeNull()
  })

  it('refuses entity counts that are partial or negative', () => {
    expect(parseImportDoc({ ...legacy(), entities: { accounts: 1, categories: 0, counterparties: 0 } })).toBeNull()
    expect(parseImportDoc({ ...legacy(), entities: { accounts: -1, categories: 0, counterparties: 0, tags: 0 } })).toBeNull()
  })
})

describe('importView (S14b)', () => {
  it('carries the entity counts into the view, zero for an MT940 import', () => {
    const finmap = parseImportDoc({ ...legacy(), kind: 'finmap', entities: { accounts: 2, categories: 5, counterparties: 7, tags: 1 } })!
    expect(importView('i3', finmap).entities).toEqual({ accounts: 2, categories: 5, counterparties: 7, tags: 1 })
    expect(importView('i4', parseImportDoc(legacy())!).entities).toEqual({ accounts: 0, categories: 0, counterparties: 0, tags: 0 })
  })

  it('carries the kind of the import, MT940 for an old document', () => {
    const doc = parseImportDoc(legacy())
    expect(doc).not.toBeNull()
    expect(importView('i1', doc!).kind).toBe('mt940')
    expect(importView('i2', parseImportDoc({ ...legacy(), kind: 'finmap' })!).kind).toBe('finmap')
  })
})
