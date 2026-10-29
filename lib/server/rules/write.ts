import 'server-only'
import { Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'
import { parseRule, ruleToDoc } from '@/lib/domain/rules/doc'
import { RuleError } from '@/lib/domain/rules/errors'
import { withCurrency, type RuleInput, type RulePatch } from '@/lib/domain/rules/input'
import { sortRules } from '@/lib/domain/rules/match'
import { MAX_RULES, type Rule, type RuleType } from '@/lib/domain/rules/types'
import { auditData } from '@/lib/server/ledger/audit'
import { auditCol, categoriesCol, counterpartiesCol, orgRef, rulesCol } from '@/lib/server/ledger/paths'

/** What a rule write needs: Admin Firestore and the clock (the ledger deps have both). */
export interface RuleDeps {
  db: Firestore
  now: () => Date
}

/** The category must exist and have the rule's type; the counterparty must exist and not be archived. */
function assertTargets(type: RuleType, category: DocumentSnapshot | null, counterparty: DocumentSnapshot | null): void {
  if (category !== null && (!category.exists || category.get('type') !== type)) throw new RuleError('category_not_found', 'actions.categoryId')
  if (counterparty !== null) {
    if (!counterparty.exists) throw new RuleError('counterparty_not_found', 'actions.counterpartyId')
    if (counterparty.get('archived') === true) throw new RuleError('counterparty_archived', 'actions.counterpartyId')
  }
}

/** A new rule at the end of the order. The limit, the targets and the write are one transaction. */
export async function createRule(deps: RuleDeps, orgId: string, uid: string, input: RuleInput): Promise<Rule> {
  const col = rulesCol(deps.db, orgId)
  const ref = col.doc()
  return deps.db.runTransaction(async (t) => {
    // All reads first.
    const org = await t.get(orgRef(deps.db, orgId))
    const existing = await t.get(col)
    const category = input.actions.categoryId === undefined ? null : await t.get(categoriesCol(deps.db, orgId).doc(input.actions.categoryId))
    const counterparty = input.actions.counterpartyId === undefined ? null : await t.get(counterpartiesCol(deps.db, orgId).doc(input.actions.counterpartyId))

    if (!org.exists) throw new RuleError('not_found')
    if (existing.size >= MAX_RULES) throw new RuleError('limit_reached')
    assertTargets(input.type, category, counterparty)

    const orders = existing.docs.map((d) => d.get('order')).filter((n): n is number => typeof n === 'number' && Number.isSafeInteger(n))
    const ts = Timestamp.fromDate(deps.now())
    const rule: Rule = {
      id: ref.id,
      name: input.name,
      type: input.type,
      active: input.active,
      order: orders.length === 0 ? 0 : Math.max(...orders) + 1,
      conditions: withCurrency(input.conditions, org.get('currency') as string),
      actions: input.actions,
      createdAtMs: ts.toMillis(),
    }
    t.create(ref, { ...ruleToDoc(rule), orgId, createdAt: ts, createdBy: uid, updatedAt: ts })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'rule.create', uid, ref.id, null, ruleToDoc(rule)))
    return rule
  })
}

/**
 * Changes what the patch gives. An action is checked again only when it changed (or, for the category, when the type
 * changed): a rule whose category was deleted can still be switched off or renamed, and stays «неробоче».
 */
export async function updateRule(deps: RuleDeps, orgId: string, uid: string, id: string, patch: RulePatch): Promise<Rule> {
  const ref = rulesCol(deps.db, orgId).doc(id)
  return deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const org = await t.get(orgRef(deps.db, orgId))
    const prior = snap.exists ? parseRule(snap.id, snap.data()) : null
    if (!prior || !org.exists) throw new RuleError('not_found')

    const type = patch.type ?? prior.type
    const actions = patch.actions ?? prior.actions
    const checkCategory = actions.categoryId !== undefined && (actions.categoryId !== prior.actions.categoryId || type !== prior.type)
    const checkCounterparty = actions.counterpartyId !== undefined && actions.counterpartyId !== prior.actions.counterpartyId
    const category = checkCategory ? await t.get(categoriesCol(deps.db, orgId).doc(actions.categoryId as string)) : null
    const counterparty = checkCounterparty ? await t.get(counterpartiesCol(deps.db, orgId).doc(actions.counterpartyId as string)) : null
    assertTargets(type, category, counterparty)

    const after: Rule = {
      ...prior,
      name: patch.name ?? prior.name,
      type,
      active: patch.active ?? prior.active,
      conditions: patch.conditions === undefined ? prior.conditions : withCurrency(patch.conditions, org.get('currency') as string),
      actions,
    }
    // `update` keeps orgId, createdAt and createdBy; `actions` and `conditions` are replaced as whole fields.
    t.update(ref, { ...ruleToDoc(after), updatedAt: Timestamp.fromDate(deps.now()) })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'rule.update', uid, id, ruleToDoc(prior), ruleToDoc(after)))
    return after
  })
}

/** Removes the rule. The operations it already filled keep their category, counterparty and trace. */
export async function deleteRule(deps: RuleDeps, orgId: string, uid: string, id: string): Promise<void> {
  const ref = rulesCol(deps.db, orgId).doc(id)
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new RuleError('not_found')
    const prior = parseRule(snap.id, snap.data())
    t.delete(ref)
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'rule.delete', uid, id, prior ? ruleToDoc(prior) : (snap.data() ?? null), null))
  })
}

/** Gives the rules the order of `ids`, which must be exactly the company's listed rules (else `conflict`: the list changed). */
export async function orderRules(deps: RuleDeps, orgId: string, uid: string, ids: readonly string[]): Promise<void> {
  const col = rulesCol(deps.db, orgId)
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(col)
    // The rules the list shows: a malformed document is hidden, so it is neither counted nor reordered.
    const listed = snap.docs.map((d) => parseRule(d.id, d.data())).filter((r): r is Rule => r !== null)
    const known = new Set(listed.map((r) => r.id))
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) throw new RuleError('conflict')
    const before = sortRules(listed).map((r) => r.id)
    const ts = Timestamp.fromDate(deps.now())
    ids.forEach((id, i) => t.update(col.doc(id), { order: i, updatedAt: ts }))
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'rule.order', uid, 'rules', { ids: before }, { ids: [...ids] }))
  })
}
