import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { parseCounterpartyInput, parseCounterpartyPatch } from '@/lib/domain/counterparties/input'

const NRB = '61109010140000071219812874'

function field(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof CounterpartyError && e.code === 'invalid_input') return e.field
    throw e
  }
  return undefined
}

describe('parseCounterpartyInput', () => {
  it('accepts a bare name', () => {
    expect(parseCounterpartyInput({ name: ' Acme ' })).toEqual({ name: 'Acme', ibans: [] })
  })

  it('normalises the NIP and the IBANs and trims the address', () => {
    expect(
      parseCounterpartyInput({ name: 'Orlen', nip: '774-000-14-54', ibans: ['PL61 1090 1014 0000 0712 1981 2874'], address: '  ul. Chemików 7, Płock ' }),
    ).toEqual({ name: 'Orlen', nip: '7740001454', ibans: [NRB], address: 'ul. Chemików 7, Płock' })
  })

  it('treats an empty address as absent', () => {
    expect(parseCounterpartyInput({ name: 'A', address: '   ' })).toEqual({ name: 'A', ibans: [] })
  })

  it.each<[unknown, string]>([
    [{}, 'name'],
    [{ name: 'A', surprise: 1 }, 'surprise'],
    [{ name: 'A', nip: '123' }, 'nip'],
    [{ name: 'A', nip: null }, 'nip'],
    [{ name: 'A', ibans: 'x' }, 'ibans'],
    [{ name: 'A', ibans: ['nope'] }, 'ibans'],
    [{ name: 'A', ibans: [NRB, NRB] }, 'ibans'],
    [{ name: 'A', address: 5 }, 'address'],
    [{ name: 'A', address: 'x'.repeat(301) }, 'address'],
    [[], 'body'],
    [null, 'body'],
  ])('refuses %j on %s', (body, expected) => {
    expect(field(() => parseCounterpartyInput(body))).toBe(expected)
  })

  it('refuses more than 20 IBANs', () => {
    const many = Array.from({ length: 21 }, () => NRB)
    expect(field(() => parseCounterpartyInput({ name: 'A', ibans: many }))).toBe('ibans')
  })
})

describe('parseCounterpartyPatch', () => {
  it('accepts any subset and normalises it', () => {
    expect(parseCounterpartyPatch({ name: ' B ', archived: true })).toEqual({ name: 'B', archived: true })
    expect(parseCounterpartyPatch({ nip: '5252344078' })).toEqual({ nip: '5252344078' })
    expect(parseCounterpartyPatch({ ibans: [NRB] })).toEqual({ ibans: [NRB] })
  })

  it('null clears the NIP and the address', () => {
    expect(parseCounterpartyPatch({ nip: null, address: null })).toEqual({ nip: null, address: null })
  })

  it.each<[unknown, string]>([
    [{}, 'body'],
    [{ archived: 'yes' }, 'archived'],
    [{ kind: 'zus' }, 'kind'],
    [{ vat: { status: 'active' } }, 'vat'],
    [{ nip: '1234567890' }, 'nip'],
    [{ name: null }, 'name'],
  ])('refuses %j on %s', (body, expected) => {
    expect(field(() => parseCounterpartyPatch(body))).toBe(expected)
  })
})
