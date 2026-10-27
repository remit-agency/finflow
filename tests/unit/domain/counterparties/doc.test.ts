import { describe, expect, it } from 'vitest'
import { counterpartyToDoc, parseCounterparty } from '@/lib/domain/counterparties/doc'
import type { Counterparty } from '@/lib/domain/counterparties/types'

const FULL: Counterparty = {
  id: 'c1',
  name: 'Orlen',
  nip: '7740001454',
  ibans: [{ iban: '61109010140000071219812874', onWhitelist: true }, { iban: '15109010140000071219812874', onWhitelist: null }],
  address: 'Płock',
  vat: { status: 'active', checkedOn: '2026-10-27' },
  kind: 'us',
  archived: false,
}

describe('counterpartyToDoc / parseCounterparty', () => {
  it('round-trips a full counterparty', () => {
    expect(parseCounterparty('c1', counterpartyToDoc(FULL))).toEqual(FULL)
  })

  it('round-trips a minimal one and omits absent optional fields', () => {
    const min: Counterparty = { id: 'c2', name: 'A', ibans: [], archived: true }
    const doc = counterpartyToDoc(min)
    expect(doc).toEqual({ schemaVersion: 1, name: 'A', ibans: [], archived: true })
    expect(parseCounterparty('c2', doc)).toEqual(min)
  })

  it.each([
    ['not an object', null],
    ['no name', { schemaVersion: 1, ibans: [], archived: false }],
    ['wrong schema', { schemaVersion: 2, name: 'A', ibans: [], archived: false }],
    ['ibans not an array', { schemaVersion: 1, name: 'A', ibans: 'x', archived: false }],
    ['iban entry malformed', { schemaVersion: 1, name: 'A', ibans: [{ iban: 5, onWhitelist: null }], archived: false }],
    ['archived not boolean', { schemaVersion: 1, name: 'A', ibans: [], archived: 'no' }],
    ['unknown vat status', { schemaVersion: 1, name: 'A', ibans: [], archived: false, vat: { status: 'maybe', checkedOn: '2026-10-27' } }],
    ['bad kind', { schemaVersion: 1, name: 'A', ibans: [], archived: false, kind: 'bank' }],
  ])('returns null for %s', (_label, data) => {
    expect(parseCounterparty('x', data)).toBeNull()
  })
})
