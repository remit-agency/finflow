import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { RuleError } from '@/lib/domain/rules/errors'
import type { Rule } from '@/lib/domain/rules/types'
import { createWithRules, syncStep } from '@/lib/server/banking/sync'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction } from '@/lib/server/ledger/write'
import { applyStep, checkStep, previewRule } from '@/lib/server/rules/apply'
import { listRules } from '@/lib/server/rules/read'
import { createRule, updateRule } from '@/lib/server/rules/write'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'
import { ORG, UID, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedCounterparty, seedOrg, seedTag, testDb } from './helpers'
import { ruleInput } from './rule-helpers'

const db = testDb()
const deps = makeDeps(db)
const txCol = () => db.collection(`organizations/${ORG}/transactions`)

const PAGE = {
  '': {
    transactions: [
      ebTx('r1', '50.00', 'DBIT', '2026-10-25', { creditor: { name: 'ORLEN STACJA 123' }, remittance_information: ['Płatność kartą'] }),
      ebTx('r2', '20.00', 'DBIT', '2026-10-26', { creditor: { name: 'Kawiarnia' }, remittance_information: ['Kawa'] }),
    ],
    continuationKey: null,
  },
}

async function byRef(ref: string): Promise<Record<string, unknown>> {
  const snap = await txCol().where('bank.entryReference', '==', ref).get()
  if (snap.empty) throw new Error(`no operation for ${ref}`)
  return snap.docs[0].data()
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof RuleError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

async function runToEnd(deps: ReturnType<typeof bankDeps>): Promise<void> {
  for (let i = 0; i < 20; i++) if ((await syncStep(deps, ORG, UID, 'ba1')).done) return
  throw new Error('sync did not finish')
}

const write = async (extra: Record<string, unknown>) =>
  (await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 1_000, paymentDate: '2026-10-20', ...extra }))).transaction.id

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
  await seedCategory(db, ORG, 'k-fuel', 'expense')
  await seedCounterparty(db, ORG, 'cp1')
  await seedTag(db, ORG, 'vat', { excludeFromAnalytics: true })
  await seedTag(db, ORG, 'q4')
  await seedTag(db, ORG, 'old', { archived: true })
})

describe('a rule that adds tags (S10t)', () => {
  it('a create refuses an unknown or archived tag; an edit checks only the tags it adds, so an unusable rule can still be switched off', async () => {
    expect(await code(createRule(deps, ORG, UID, ruleInput({ actions: { tagIds: ['ghost'] } })))).toBe('tag_not_found:actions.tagIds')
    expect(await code(createRule(deps, ORG, UID, ruleInput({ actions: { tagIds: ['old'] } })))).toBe('tag_archived:actions.tagIds')
    const rule = await createRule(deps, ORG, UID, ruleInput({ actions: { tagIds: ['q4'] } }))
    await db.doc(`organizations/${ORG}/tags/q4`).update({ archived: true })
    await updateRule(deps, ORG, UID, rule.id, { active: false })
    expect((await listRules(db, ORG))[0].unusable).toEqual(['tags'])
    expect(await code(updateRule(deps, ORG, UID, rule.id, { actions: { tagIds: ['q4', 'old'] } }))).toBe('tag_archived:actions.tagIds')
  })

  it('the bank import adds the tags next to the category; the excluding tag sends the operation to the x_ rollups', async () => {
    await createRule(deps, ORG, UID, ruleInput({ actions: { categoryId: 'k-fuel', tagIds: ['vat'] } }))
    await seedBank(db)
    const bank = bankDeps(db, fakeEb(PAGE))
    await runToEnd(bank)
    expect(await byRef('r1')).toMatchObject({ categoryId: 'k-fuel', tags: ['vat'], excluded: true })
    expect((await byRef('r2')).tags).toEqual([])
    expect(await rollup(db, ORG, 'x_cash_a1_2026-10-25')).toMatchObject({ outMinor: 5_000 })
    expect((await verifyLedger(bank.ledger, ORG)).ok).toBe(true)
  })

  it('when the ledger refuses a tag the rules gave (archived after they were read), the operation is written without the rule', async () => {
    await seedBank(db)
    const bank = bankDeps(db, fakeEb(PAGE))
    const stale: Rule = {
      id: 'r-stale', name: 'Stale', type: 'expense', active: true, order: 0, createdAtMs: 0,
      conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }], actions: { categoryId: 'k-fuel', tagIds: ['old'] },
    }
    const input = parseTransactionInput({ clientId: 'bk_tagfallback1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 5_000, paymentDate: '2026-10-25' }, { internal: true })
    await createWithRules(bank, ORG, UID, input, { accountRef: 'ba1', counterpartyName: 'ORLEN STACJA 123' }, 'PLN', [stale])
    const doc = await readDoc(db, `organizations/${ORG}/transactions/bk_tagfallback1`)
    expect(doc).toMatchObject({ source: 'bank', tags: [] })
    expect(doc?.categoryId).toBeUndefined()
    expect(doc?.autoRules).toBeUndefined()
  })

  it('«Застосувати до наявних» adds the tags to an operation that already has a category; the check counts them', async () => {
    const tagged = await write({ description: 'ORLEN', categoryId: 'k-fuel', tags: ['q4'] })
    await write({ description: 'Kawa' })
    await createRule(deps, ORG, UID, ruleInput({ actions: { tagIds: ['vat'] } }))
    expect(await checkStep(deps, ORG, null)).toMatchObject({ scanned: 2, matchOps: 1, categories: 0, counterparties: 0, tags: 1, done: true })
    expect(await applyStep(deps, ORG, UID, null)).toMatchObject({ changed: 1, failed: 0, done: true })
    expect(await readDoc(db, `organizations/${ORG}/transactions/${tagged}`)).toMatchObject({
      tags: ['q4', 'vat'],
      excluded: true,
      autoRules: [{ id: expect.any(String), name: 'Paliwo' }],
    })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect(await checkStep(deps, ORG, null)).toMatchObject({ matchOps: 0, tags: 0 })
  })

  it('«Перевірити» counts an operation with a category and a counterparty that lacks a tag of the rule', async () => {
    await write({ description: 'ORLEN', categoryId: 'k-fuel', counterpartyId: 'cp1' })
    expect(await previewRule(deps, ORG, ruleInput({ actions: { tagIds: ['vat'] } }))).toEqual({ matched: 1, scanned: 1, capped: false })
    expect(await previewRule(deps, ORG, ruleInput({ actions: { categoryId: 'k-fuel' } }))).toEqual({ matched: 0, scanned: 0, capped: false })
  })
})
