import { beforeEach, describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { ruleToDoc } from '@/lib/domain/rules/doc'
import { RuleError } from '@/lib/domain/rules/errors'
import { MAX_RULES, type Rule } from '@/lib/domain/rules/types'
import { listRules, loadUsableRules } from '@/lib/server/rules/read'
import { createRule, deleteRule, orderRules, updateRule } from '@/lib/server/rules/write'
import { ORG, UID, auditActions, clearFirestore, makeDeps, readDoc, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'
import { ruleInput } from './rule-helpers'

const db = testDb()
const deps = makeDeps(db)
const ruleDoc = (id: string) => readDoc(db, `organizations/${ORG}/rules/${id}`)
const rulesCount = async () => (await db.collection(`organizations/${ORG}/rules`).get()).size

async function failure(p: Promise<unknown>): Promise<RuleError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(RuleError)
    return e as RuleError
  }
  throw new Error('expected a RuleError')
}

async function auditEntry(action: string): Promise<Record<string, unknown>> {
  const snap = await db.collection(`organizations/${ORG}/audit`).where('action', '==', action).get()
  return snap.docs[0].data()
}

/** A rule document as the server stores it, written directly (fast for the limit test, any shape for the list test). */
async function seedRuleDoc(id: string, order: number, over: Partial<Rule> = {}): Promise<void> {
  const rule: Rule = {
    id, name: id, type: 'expense', active: true, order, createdAtMs: 0,
    conditions: [{ kind: 'text', op: 'contains', values: ['x'] }], actions: { categoryId: 'k-fuel' }, ...over,
  }
  await db.doc(`organizations/${ORG}/rules/${id}`).set({
    ...ruleToDoc(rule), orgId: ORG, createdAt: Timestamp.fromMillis(1_790_000_000_000 + order), createdBy: UID, updatedAt: Timestamp.now(),
  })
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedCategory(db, ORG, 'k-fuel', 'expense')
  await seedCategory(db, ORG, 'k-sales', 'income')
  await seedCounterparty(db, ORG, 'cp-orlen')
  await seedCounterparty(db, ORG, 'cp-old', { archived: true })
})

describe('createRule', () => {
  it('writes the rule at the end of the order with an audit entry; an amount without a currency takes the company currency', async () => {
    const first = await createRule(deps, ORG, UID, ruleInput())
    const second = await createRule(deps, ORG, UID, ruleInput({ name: 'Duże', conditions: [{ kind: 'amount', minMinor: 100_000 }] }))
    expect(first.order).toBe(0)
    expect(second.order).toBe(1)
    expect(await ruleDoc(second.id)).toMatchObject({
      schemaVersion: 1, orgId: ORG, name: 'Duże', type: 'expense', active: true, order: 1, createdBy: UID,
      conditions: [{ kind: 'amount', currency: 'PLN', minMinor: 100_000 }], actions: { categoryId: 'k-fuel' },
    })
    expect(await auditActions(db, ORG)).toEqual(['rule.create', 'rule.create'])
    expect(await auditEntry('rule.create')).toMatchObject({ uid: UID, before: null })
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['a category that does not exist', { actions: { categoryId: 'k-gone' } }, 'category_not_found'],
    ['a category of the other type', { actions: { categoryId: 'k-sales' } }, 'category_not_found'],
    ['a counterparty that does not exist', { actions: { counterpartyId: 'cp-gone' } }, 'counterparty_not_found'],
    ['an archived counterparty', { actions: { counterpartyId: 'cp-old' } }, 'counterparty_archived'],
  ])('refuses %s and writes nothing', async (_name, over, code) => {
    expect((await failure(createRule(deps, ORG, UID, ruleInput(over)))).code).toBe(code)
    expect(await rulesCount()).toBe(0)
    expect(await auditActions(db, ORG)).toEqual([])
  })

  it(`refuses a rule over the limit of ${MAX_RULES} (limit_reached)`, async () => {
    for (let i = 0; i < MAX_RULES; i++) await seedRuleDoc(`r${String(i).padStart(2, '0')}`, i)
    expect((await failure(createRule(deps, ORG, UID, ruleInput()))).code).toBe('limit_reached')
    expect(await rulesCount()).toBe(MAX_RULES)
  })

  it('refuses an unknown company', async () => {
    expect((await failure(createRule(deps, 'ghost', UID, ruleInput()))).code).toBe('not_found')
  })
})

describe('updateRule', () => {
  it('changes what is given, keeps the rest, and audits before and after', async () => {
    const rule = await createRule(deps, ORG, UID, ruleInput())
    const after = await updateRule(deps, ORG, UID, rule.id, { name: 'Paliwo i myjnia', conditions: [{ kind: 'text', op: 'contains', values: ['orlen', 'myjnia'] }] })
    expect(after).toMatchObject({ id: rule.id, name: 'Paliwo i myjnia', order: 0, active: true, actions: { categoryId: 'k-fuel' } })
    expect(await ruleDoc(rule.id)).toMatchObject({ name: 'Paliwo i myjnia', createdBy: UID, conditions: [{ kind: 'text', op: 'contains', values: ['orlen', 'myjnia'] }] })
    expect(await auditEntry('rule.update')).toMatchObject({ targetId: rule.id, before: { name: 'Paliwo' }, after: { name: 'Paliwo i myjnia' } })
  })

  it('switching a rule off works even when its category was deleted meanwhile (an unchanged action is not checked again)', async () => {
    const rule = await createRule(deps, ORG, UID, ruleInput())
    await db.doc(`organizations/${ORG}/categories/k-fuel`).delete()
    expect((await updateRule(deps, ORG, UID, rule.id, { active: false })).active).toBe(false)
  })

  it('a new action or a new type is checked again', async () => {
    const rule = await createRule(deps, ORG, UID, ruleInput())
    expect((await failure(updateRule(deps, ORG, UID, rule.id, { type: 'income' }))).code).toBe('category_not_found')
    expect((await failure(updateRule(deps, ORG, UID, rule.id, { actions: { categoryId: 'k-fuel', counterpartyId: 'cp-old' } }))).code).toBe('counterparty_archived')
    expect((await updateRule(deps, ORG, UID, rule.id, { type: 'income', actions: { categoryId: 'k-sales' } })).type).toBe('income')
  })

  it('removes an action that the new actions leave out', async () => {
    const rule = await createRule(deps, ORG, UID, ruleInput({ actions: { categoryId: 'k-fuel', counterpartyId: 'cp-orlen' } }))
    await updateRule(deps, ORG, UID, rule.id, { actions: { counterpartyId: 'cp-orlen' } })
    expect((await ruleDoc(rule.id))?.actions).toEqual({ counterpartyId: 'cp-orlen' })
  })

  it('answers not_found for a rule that does not exist', async () => {
    expect((await failure(updateRule(deps, ORG, UID, 'missing', { active: false }))).code).toBe('not_found')
  })
})

describe('deleteRule', () => {
  it('removes the rule and audits it; a second delete is not_found', async () => {
    const rule = await createRule(deps, ORG, UID, ruleInput())
    await deleteRule(deps, ORG, UID, rule.id)
    expect(await ruleDoc(rule.id)).toBeUndefined()
    expect(await auditActions(db, ORG)).toEqual(['rule.create', 'rule.delete'])
    expect(await auditEntry('rule.delete')).toMatchObject({ targetId: rule.id, before: { name: 'Paliwo' }, after: null })
    expect((await failure(deleteRule(deps, ORG, UID, rule.id))).code).toBe('not_found')
  })
})

describe('orderRules', () => {
  it('sets the order from the list of all ids and audits the change', async () => {
    const a = await createRule(deps, ORG, UID, ruleInput({ name: 'A' }))
    const b = await createRule(deps, ORG, UID, ruleInput({ name: 'B' }))
    const c = await createRule(deps, ORG, UID, ruleInput({ name: 'C' }))
    await orderRules(deps, ORG, UID, [c.id, a.id, b.id])
    expect((await listRules(db, ORG)).map((r) => r.name)).toEqual(['C', 'A', 'B'])
    expect(await auditEntry('rule.order')).toMatchObject({ targetId: 'rules', before: { ids: [a.id, b.id, c.id] }, after: { ids: [c.id, a.id, b.id] } })
  })

  it('orders the rules the list shows: a malformed document is not counted and keeps its order value', async () => {
    const a = await createRule(deps, ORG, UID, ruleInput({ name: 'A' }))
    const b = await createRule(deps, ORG, UID, ruleInput({ name: 'B' }))
    await db.doc(`organizations/${ORG}/rules/r-bad`).set({ schemaVersion: 1, name: 'bad', orgId: ORG, order: 7, actions: { categoryId: 'x/y' } })
    await orderRules(deps, ORG, UID, [b.id, a.id])
    expect((await listRules(db, ORG)).map((r) => r.name)).toEqual(['B', 'A'])
    expect((await readDoc(db, `organizations/${ORG}/rules/r-bad`))?.order).toBe(7)
    expect((await failure(orderRules(deps, ORG, UID, [b.id, a.id, 'r-bad']))).code).toBe('conflict')
  })

  it('refuses a list that is not exactly the company rules (conflict) and changes nothing', async () => {
    const a = await createRule(deps, ORG, UID, ruleInput({ name: 'A' }))
    const b = await createRule(deps, ORG, UID, ruleInput({ name: 'B' }))
    expect((await failure(orderRules(deps, ORG, UID, [a.id]))).code).toBe('conflict')
    expect((await failure(orderRules(deps, ORG, UID, [a.id, 'other']))).code).toBe('conflict')
    expect((await failure(orderRules(deps, ORG, UID, [b.id, a.id, 'extra']))).code).toBe('conflict')
    expect((await listRules(db, ORG)).map((r) => r.name)).toEqual(['A', 'B'])
  })
})

describe('listRules and loadUsableRules', () => {
  it('lists every rule in order with what no longer works; a malformed document is left out', async () => {
    await seedRuleDoc('r-ok', 0)
    await seedRuleDoc('r-gone', 1, { actions: { categoryId: 'k-gone' } })
    await seedRuleDoc('r-type', 2, { actions: { categoryId: 'k-sales' } })
    await seedRuleDoc('r-cp', 3, { actions: { counterpartyId: 'cp-old' } })
    await db.doc(`organizations/${ORG}/rules/r-bad`).set({ schemaVersion: 1, name: 'bad', orgId: ORG })
    const listed = await listRules(db, ORG)
    expect(listed.map((r) => [r.id, r.unusable])).toEqual([['r-ok', []], ['r-gone', ['category']], ['r-type', ['category']], ['r-cp', ['counterparty']]])
  })

  it('what a sync or an apply uses: active rules only, without the actions that cannot work', async () => {
    await seedRuleDoc('r-ok', 0, { actions: { categoryId: 'k-fuel', counterpartyId: 'cp-old' } })
    await seedRuleDoc('r-off', 1, { active: false })
    expect((await loadUsableRules(db, ORG)).map((r) => [r.id, r.actions])).toEqual([['r-ok', { categoryId: 'k-fuel' }]])
  })

  it('a company without rules has an empty list', async () => {
    expect(await loadUsableRules(db, ORG)).toEqual([])
    expect(await listRules(db, ORG)).toEqual([])
  })
})
