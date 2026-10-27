import { describe, expect, it } from 'vitest'
import { filterCounterparties } from '@/lib/domain/counterparties/search'
import type { Counterparty } from '@/lib/domain/counterparties/types'

const c = (id: string, name: string, extra: Partial<Counterparty> = {}): Counterparty => ({ id, name, ibans: [], archived: false, ...extra })

const LIST = [
  c('1', 'Zakład Łączności', { nip: '7740001454' }),
  c('2', 'ZUS', { kind: 'zus' }),
  c('3', 'Acme', { archived: true }),
  c('4', 'Alfa Beta', { nip: '5252344078' }),
]

describe('filterCounterparties', () => {
  it('returns the active ones, sorted by name, for an empty query', () => {
    expect(filterCounterparties(LIST, '').map((x) => x.id)).toEqual(['4', '1', '2'])
  })

  it('includes archived ones on request', () => {
    expect(filterCounterparties(LIST, '', { includeArchived: true }).map((x) => x.id)).toEqual(['3', '4', '1', '2'])
  })

  it('matches names without regard to case or diacritics', () => {
    expect(filterCounterparties(LIST, 'laczn').map((x) => x.id)).toEqual(['1'])
    expect(filterCounterparties(LIST, 'ALFA').map((x) => x.id)).toEqual(['4'])
  })

  it('matches a NIP typed with separators or a PL prefix', () => {
    expect(filterCounterparties(LIST, '774-000').map((x) => x.id)).toEqual(['1'])
    expect(filterCounterparties(LIST, 'PL5252344078').map((x) => x.id)).toEqual(['4'])
  })

  it('matches every word of a multi-word query', () => {
    expect(filterCounterparties(LIST, 'alfa beta').map((x) => x.id)).toEqual(['4'])
    expect(filterCounterparties(LIST, 'alfa zus')).toEqual([])
  })
})
