import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { Rule } from '@/lib/domain/rules/types'
import { runBackgroundSync } from '@/lib/server/banking/background'
import { createWithRules, syncStep } from '@/lib/server/banking/sync'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createRule, updateRule } from '@/lib/server/rules/write'
import { ORG, UID, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'
import { ruleInput } from './rule-helpers'

const db = testDb()
const txCol = () => db.collection(`organizations/${ORG}/transactions`)

async function byRef(ref: string): Promise<{ id: string; data: Record<string, unknown> }> {
  const snap = await txCol().where('bank.entryReference', '==', ref).get()
  if (snap.empty) throw new Error(`no operation for ${ref}`)
  return { id: snap.docs[0].id, data: snap.docs[0].data() }
}

async function createdEntry(txId: string): Promise<Record<string, unknown> | undefined> {
  const snap = await db.collection(`organizations/${ORG}/audit`).where('targetId', '==', txId).where('action', '==', 'tx.create').get()
  return snap.docs[0]?.data()
}

async function runToEnd(deps: ReturnType<typeof bankDeps>, max = 20): Promise<void> {
  for (let i = 0; i < max; i++) if ((await syncStep(deps, ORG, UID, 'ba1')).done) return
  throw new Error('sync did not finish')
}

const PAGE = {
  '': {
    transactions: [
      ebTx('r1', '50.00', 'DBIT', '2026-10-25', { creditor: { name: 'ORLEN STACJA 123' }, remittance_information: ['Płatność kartą'] }),
      ebTx('r2', '20.00', 'DBIT', '2026-10-26', { creditor: { name: 'Kawiarnia' }, remittance_information: ['Kawa'] }),
      ebTx('r3', '70.00', 'CRDT', '2026-10-26', { debtor: { name: 'ORLEN zwrot' }, remittance_information: ['Zwrot'] }),
    ],
    continuationKey: null,
  },
}

/** A rule as the step would have read it before its action stopped working. */
const staleRule = (actions: Rule['actions']): Rule => ({
  id: 'r-stale', name: 'Stale', type: 'expense', active: true, order: 0, createdAtMs: 0,
  conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }], actions,
})

const bankInput = (clientId: string) =>
  parseTransactionInput({ clientId, type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 5_000, paymentDate: '2026-10-25' }, { internal: true })

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
  await seedCategory(db, ORG, 'k-fuel', 'expense')
  await seedCounterparty(db, ORG, 'cp-orlen')
})

describe('a bank import with rules', () => {
  it('gives a matching new operation the category and counterparty of the rule, with autoRules and via rule in the audit', async () => {
    const rule = await createRule(makeDeps(db), ORG, UID, ruleInput({ actions: { categoryId: 'k-fuel', counterpartyId: 'cp-orlen' } }))
    await seedBank(db)
    const deps = bankDeps(db, fakeEb(PAGE))
    await runToEnd(deps)

    const fuel = await byRef('r1')
    expect(fuel.data).toMatchObject({ categoryId: 'k-fuel', counterpartyId: 'cp-orlen', autoRules: [{ id: rule.id, name: 'Paliwo' }] })
    expect(await createdEntry(fuel.id)).toMatchObject({ via: 'rule' })

    // Another text, and an income (the rule is for expenses): imported exactly as before S10.
    for (const ref of ['r2', 'r3']) {
      const other = await byRef(ref)
      expect(other.data.categoryId).toBeUndefined()
      expect(other.data.autoRules).toBeUndefined()
      const entry = await createdEntry(other.id)
      expect(entry?.action).toBe('tx.create')
      expect(entry).not.toHaveProperty('via')
    }
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('an inactive rule does nothing', async () => {
    const rule = await createRule(makeDeps(db), ORG, UID, ruleInput())
    await updateRule(makeDeps(db), ORG, UID, rule.id, { active: false })
    await seedBank(db)
    await runToEnd(bankDeps(db, fakeEb(PAGE)))
    expect((await byRef('r1')).data.categoryId).toBeUndefined()
  })

  it('a rule whose category was deleted still gives its counterparty, and no operation is lost', async () => {
    await createRule(makeDeps(db), ORG, UID, ruleInput({ actions: { categoryId: 'k-fuel', counterpartyId: 'cp-orlen' } }))
    await db.doc(`organizations/${ORG}/categories/k-fuel`).delete()
    await seedBank(db)
    await runToEnd(bankDeps(db, fakeEb(PAGE)))
    const fuel = await byRef('r1')
    expect(fuel.data.categoryId).toBeUndefined()
    expect(fuel.data).toMatchObject({ counterpartyId: 'cp-orlen' })
    expect((await txCol().get()).size).toBe(3)
  })

  it('when the ledger refuses the category the rules gave (it went away after they were read), the operation is written without it', async () => {
    await seedBank(db)
    const deps = bankDeps(db, fakeEb(PAGE))
    const written = await createWithRules(deps, ORG, UID, bankInput('bk_fallback01'), { accountRef: 'ba1', counterpartyName: 'ORLEN STACJA 123' }, 'PLN', [staleRule({ categoryId: 'k-deleted' })])
    expect(written.replayed).toBe(false)
    const doc = await readDoc(db, `organizations/${ORG}/transactions/bk_fallback01`)
    expect(doc).toMatchObject({ source: 'bank', amountMinor: 5_000 })
    expect(doc?.categoryId).toBeUndefined()
    expect(doc?.autoRules).toBeUndefined()
  })

  it('the same for a counterparty archived after the rules were read', async () => {
    await seedCounterparty(db, ORG, 'cp-old', { archived: true })
    await seedBank(db)
    const deps = bankDeps(db, fakeEb(PAGE))
    await createWithRules(deps, ORG, UID, bankInput('bk_fallback02'), { accountRef: 'ba1', counterpartyName: 'ORLEN STACJA 123' }, 'PLN', [staleRule({ counterpartyId: 'cp-old' })])
    const doc = await readDoc(db, `organizations/${ORG}/transactions/bk_fallback02`)
    expect(doc).toMatchObject({ source: 'bank' })
    expect(doc?.counterpartyId).toBeUndefined()
    expect(doc?.autoRules).toBeUndefined()
  })
})

describe('the background refresh (S09b) applies the rules too', () => {
  it('categorises what it imports', async () => {
    await createRule(makeDeps(db), ORG, UID, ruleInput())
    await seedBank(db, { firstSyncDone: true, syncedThrough: '2026-10-26' })
    const summary = await runBackgroundSync(bankDeps(db, fakeEb(PAGE), new Date('2026-10-27T10:00:00Z')))
    expect(summary).toMatchObject({ synced: 1, imported: 3 })
    expect((await byRef('r1')).data).toMatchObject({ categoryId: 'k-fuel' })
  })
})
