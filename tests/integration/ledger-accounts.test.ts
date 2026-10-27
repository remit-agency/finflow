import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseAccountInput, parseAccountPatch, parseOrgPatch } from '@/lib/domain/ledger/entity-input'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { createAccount, deleteAccount, updateAccount } from '@/lib/server/ledger/accounts'
import { acquireLock } from '@/lib/server/ledger/lock'
import { updateOrganization } from '@/lib/server/ledger/org'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

const ACC = { name: 'Main', type: 'bank', currency: 'PLN', color: '#00c896', openingMinor: 5000 }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
})

describe('accounts', () => {
  it('create sets balance = opening and audits', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    expect(acc.balanceMinor).toBe(5000)
    expect(await readDoc(db, `organizations/${ORG}/accounts/${acc.id}`)).toMatchObject({ schemaVersion: 2, openingMinor: 5000, balanceMinor: 5000, orgId: ORG })
    expect(await auditActions(db, ORG)).toEqual(['account.create'])
  })

  it('editing the opening balance moves the balance by the difference', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: acc.id, amountMinor: 700, paymentDate: '2026-10-20' }))
    const out = await updateAccount(deps, ORG, UID, acc.id, parseAccountPatch({ openingMinor: 6000, name: 'Renamed' }))
    expect(out).toMatchObject({ name: 'Renamed', openingMinor: 6000, balanceMinor: 6700 })
    expect(await balanceOf(db, ORG, acc.id)).toBe(6700)
  })

  it('the currency can change only while the account has no operations; any status counts', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    expect((await updateAccount(deps, ORG, UID, acc.id, parseAccountPatch({ currency: 'EUR' }))).currency).toBe('EUR')
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', status: 'planned', accountId: acc.id, amountMinor: 1, paymentDate: '2026-11-20' }))
    expect(await code(updateAccount(deps, ORG, UID, acc.id, parseAccountPatch({ currency: 'PLN' })))).toBe('account_has_operations:currency')
  })

  it('an account with operations (as source or as target) cannot be deleted; an empty one can', async () => {
    const a = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    const b = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    const empty = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'transfer', accountId: a.id, toAccountId: b.id, amountMinor: 100, paymentDate: '2026-10-20' }))
    expect(await code(deleteAccount(deps, ORG, UID, a.id))).toBe('account_has_operations:undefined')
    expect(await code(deleteAccount(deps, ORG, UID, b.id))).toBe('account_has_operations:undefined')
    await deleteAccount(deps, ORG, UID, empty.id)
    expect(await readDoc(db, `organizations/${ORG}/accounts/${empty.id}`)).toBeUndefined()
    expect(await auditActions(db, ORG)).toContain('account.delete')
  })

  it('writes are refused while the ledger is locked', async () => {
    await acquireLock(deps, ORG, 'test')
    expect(await code(createAccount(deps, ORG, UID, parseAccountInput(ACC)))).toBe('ledger_busy:undefined')
  })

  it('an unknown account is not_found', async () => {
    expect(await code(updateAccount(deps, ORG, UID, 'nope', parseAccountPatch({ name: 'x' })))).toBe('not_found:undefined')
    expect(await code(deleteAccount(deps, ORG, UID, 'nope'))).toBe('not_found:undefined')
  })
})

describe('updateOrganization', () => {
  it('renames and changes the currency of an empty company', async () => {
    expect(await updateOrganization(deps, ORG, UID, parseOrgPatch({ name: 'New', currency: 'EUR' }))).toEqual({ name: 'New', currency: 'EUR' })
    expect(await readDoc(db, `organizations/${ORG}`)).toMatchObject({ name: 'New', currency: 'EUR', ownerId: UID })
    expect(await auditActions(db, ORG)).toEqual(['org.update'])
  })

  it('freezes the currency once there is an operation, but still allows a rename', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: acc.id, amountMinor: 1, paymentDate: '2026-10-20' }))
    expect(await code(updateOrganization(deps, ORG, UID, parseOrgPatch({ currency: 'EUR' })))).toBe('currency_locked:currency')
    expect((await updateOrganization(deps, ORG, UID, parseOrgPatch({ name: 'Renamed' }))).name).toBe('Renamed')
    expect(await updateOrganization(deps, ORG, UID, parseOrgPatch({ currency: 'PLN' }))).toMatchObject({ currency: 'PLN' })
  })
})
