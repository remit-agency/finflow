import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeMembers, fakeOrgs, fakeOtherDocs, fakeTxFault, resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { HttpError } from '@/lib/server/http-error'
import { createOrganizationForUser, parseCreateOrgInput } from '@/lib/server/orgs'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})

describe('parseCreateOrgInput', () => {
  it('accepts a valid body and trims the name', () => {
    expect(parseCreateOrgInput({ name: '  Acme sp. z o.o.  ', currency: 'PLN' })).toEqual({
      name: 'Acme sp. z o.o.',
      currency: 'PLN',
    })
  })

  it.each(['PLN', 'EUR', 'USD', 'UAH'])('accepts currency %s', (currency) => {
    expect(parseCreateOrgInput({ name: 'A', currency }).currency).toBe(currency)
  })

  it('accepts a 120 character name and rejects 121', () => {
    expect(parseCreateOrgInput({ name: 'x'.repeat(120), currency: 'PLN' }).name).toHaveLength(120)
    expect(() => parseCreateOrgInput({ name: 'x'.repeat(121), currency: 'PLN' })).toThrow(HttpError)
  })

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', []],
    ['no name', { currency: 'PLN' }],
    ['an empty name', { name: '', currency: 'PLN' }],
    ['a blank name', { name: '   ', currency: 'PLN' }],
    ['a non-string name', { name: 5, currency: 'PLN' }],
    ['no currency', { name: 'A' }],
    ['a currency outside the list', { name: 'A', currency: 'GBP' }],
    ['a lowercase currency', { name: 'A', currency: 'pln' }],
    ['an extra field', { name: 'A', currency: 'PLN', ownerId: 'someone' }],
    ['an extra plan field', { name: 'A', currency: 'PLN', plan: 'pro' }],
  ])('rejects %s with 400', (_label, body) => {
    const run = () => parseCreateOrgInput(body)
    expect(run).toThrow(HttpError)
    try {
      run()
    } catch (e) {
      expect((e as HttpError).status).toBe(400)
    }
  })

  it('rejects a __proto__ key', () => {
    expect(() => parseCreateOrgInput(JSON.parse('{"name":"A","currency":"PLN","__proto__":{"x":1}}'))).toThrow(HttpError)
  })
})

describe('createOrganizationForUser seeds the system counterparties', () => {
  beforeEach(() => {
    resetFakeAdmin()
  })

  it('a successful create leaves exactly the two system records and their two name keys', async () => {
    const orgId = await createOrganizationForUser('user-mallory', { name: 'New Co', currency: 'PLN' }, new Date('2026-10-27T10:00:00Z'))

    expect(fakeOrgs.has(orgId)).toBe(true)
    expect(fakeMembers.has(`${orgId}/user-mallory`)).toBe(true)
    expect([...fakeOtherDocs.keys()].sort()).toEqual(
      [
        `organizations/${orgId}/counterparties/system_us`,
        `organizations/${orgId}/counterparties/system_zus`,
        `organizations/${orgId}/counterpartyKeys/name_urzad_skarbowy`,
        `organizations/${orgId}/counterpartyKeys/name_zus`,
      ].sort(),
    )
  })

  it('is atomic: when a seeding write fails, neither the organization nor the membership is left behind', async () => {
    fakeTxFault.failOnCreatePathIncludes = '/counterparties/'

    await expect(createOrganizationForUser('user-mallory', { name: 'New Co', currency: 'PLN' })).rejects.toThrow()

    expect(fakeOrgs.size).toBe(1) // only the fixture org-acme
    expect(fakeMembers.has('org-acme/user-alice')).toBe(true)
    expect([...fakeMembers.keys()].filter((k) => k.endsWith('/user-mallory'))).toEqual([])
    expect(fakeOtherDocs.size).toBe(0)
  })
})
