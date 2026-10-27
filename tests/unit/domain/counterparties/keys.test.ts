import { describe, expect, it } from 'vitest'
import { keyField, keysOf } from '@/lib/domain/counterparties/keys'
import { SYSTEM_COUNTERPARTIES, systemCounterparty } from '@/lib/domain/counterparties/system'

describe('keysOf', () => {
  it('lists the NIP key first, then the name key', () => {
    expect(keysOf({ name: 'Zakład Łączności', nip: '7740001454' })).toEqual(['nip_7740001454', 'name_zaklad_lacznosci'])
  })

  it('has only the name key without a NIP', () => {
    expect(keysOf({ name: 'Acme' })).toEqual(['name_acme'])
  })
})

describe('keyField', () => {
  it('names the field a key belongs to', () => {
    expect(keyField('nip_7740001454')).toBe('nip')
    expect(keyField('name_acme')).toBe('name')
  })
})

describe('system counterparties', () => {
  it('are ZUS and Urząd Skarbowy with fixed ids and kinds', () => {
    expect(SYSTEM_COUNTERPARTIES.map((s) => [s.id, s.kind, s.name])).toEqual([
      ['system_zus', 'zus', 'ZUS'],
      ['system_us', 'us', 'Urząd Skarbowy'],
    ])
  })

  it('build counterparties without NIP or IBAN', () => {
    expect(systemCounterparty(SYSTEM_COUNTERPARTIES[0])).toEqual({ id: 'system_zus', name: 'ZUS', ibans: [], archived: false, kind: 'zus' })
  })
})
