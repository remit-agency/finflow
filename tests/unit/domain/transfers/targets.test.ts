import { describe, expect, it } from 'vitest'
import { bankLinkedIds, convertTargets } from '@/lib/domain/transfers/targets'

const acc = (id: string, currency = 'PLN') => ({ id, currency, name: id })
const accounts = [acc('mil'), acc('mono'), acc('cash'), acc('eur', 'EUR'), acc('cash2')]
const source = acc('mil')

describe('bankLinkedIds', () => {
  it('is null when the browser cannot see the bank accounts (a role without them, or not read yet)', () => {
    expect(bankLinkedIds(undefined)).toBeNull()
  })

  it('holds the account of every bank account, the disconnected ones too', () => {
    expect(bankLinkedIds([{ accountId: 'mono' }, { accountId: 'cash' }])).toEqual(new Set(['mono', 'cash']))
    expect(bankLinkedIds([])).toEqual(new Set())
  })
})

describe('convertTargets', () => {
  it('offers the other accounts of the same currency, in their order, and leaves the source out', () => {
    expect(convertTargets(accounts, source, null).map((a) => a.id)).toEqual(['mono', 'cash', 'cash2'])
  })

  it('hides the accounts a bank is linked to, when the links are known', () => {
    expect(convertTargets(accounts, source, new Set(['mono']))).toEqual([acc('cash'), acc('cash2')])
  })

  it('hides nothing when no link is known: the server decides', () => {
    expect(convertTargets(accounts, source, null).map((a) => a.id)).toContain('mono')
  })

  it('a linked source is still the source; other currencies are never targets', () => {
    expect(convertTargets(accounts, source, new Set(['mil', 'eur', 'cash']))).toEqual([acc('mono'), acc('cash2')])
  })
})
