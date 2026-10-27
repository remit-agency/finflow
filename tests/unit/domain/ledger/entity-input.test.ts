import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseAccountInput, parseAccountPatch, parseOrgPatch } from '@/lib/domain/ledger/entity-input'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'none'
}

const ACC = { name: ' Main ', type: 'bank', currency: 'PLN', color: '#00c896', openingMinor: 12345 }

describe('parseAccountInput', () => {
  it('trims the name and keeps a negative opening balance', () => {
    expect(parseAccountInput(ACC)).toEqual({ ...ACC, name: 'Main' })
    expect(parseAccountInput({ ...ACC, openingMinor: -500 }).openingMinor).toBe(-500)
  })

  it.each([
    ['no name', { ...ACC, name: ' ' }, 'invalid_input:name'],
    ['a long name', { ...ACC, name: 'x'.repeat(121) }, 'invalid_input:name'],
    ['a bad type', { ...ACC, type: 'wallet' }, 'invalid_input:type'],
    ['a bad currency', { ...ACC, currency: 'GBP' }, 'invalid_input:currency'],
    ['a bad color', { ...ACC, color: 'green' }, 'invalid_input:color'],
    ['a fractional opening', { ...ACC, openingMinor: 1.5 }, 'invalid_input:openingMinor'],
    ['an unknown key', { ...ACC, balanceMinor: 5 }, 'invalid_input:balanceMinor'],
  ])('rejects %s', (_l, body, expected) => {
    expect(code(() => parseAccountInput(body))).toBe(expected)
  })
})

describe('parseAccountPatch', () => {
  it('accepts a subset and needs at least one key', () => {
    expect(parseAccountPatch({ name: 'B', openingMinor: 0 })).toEqual({ name: 'B', openingMinor: 0 })
    expect(code(() => parseAccountPatch({}))).toBe('invalid_input:body')
  })
})

describe('parseOrgPatch', () => {
  it('accepts name and/or currency', () => {
    expect(parseOrgPatch({ name: ' Acme ' })).toEqual({ name: 'Acme' })
    expect(parseOrgPatch({ currency: 'EUR' })).toEqual({ currency: 'EUR' })
    expect(code(() => parseOrgPatch({ currency: 'GBP' }))).toBe('invalid_input:currency')
    expect(code(() => parseOrgPatch({}))).toBe('invalid_input:body')
    expect(code(() => parseOrgPatch({ plan: 'pro' }))).toBe('invalid_input:plan')
  })
})
