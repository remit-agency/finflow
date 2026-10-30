import 'server-only'
import type { Firestore } from 'firebase-admin/firestore'
import { parseRule } from '@/lib/domain/rules/doc'
import { sortRules } from '@/lib/domain/rules/match'
import type { ActionTargets, ListedRule, Rule, RuleActions, RuleType } from '@/lib/domain/rules/types'
import { unusableActions, withoutUnusableActions } from '@/lib/domain/rules/usable'
import { categoriesCol, counterpartiesCol, rulesCol, tagsCol } from '@/lib/server/ledger/paths'

/** Every readable rule of the company (at most 50) in the order they apply; a malformed document is left out. */
export async function readRules(db: Firestore, orgId: string): Promise<Rule[]> {
  const snap = await rulesCol(db, orgId).get()
  return sortRules(snap.docs.map((d) => parseRule(d.id, d.data())).filter((r): r is Rule => r !== null))
}

function idsOf(rules: readonly Rule[], pick: (actions: RuleActions) => readonly string[]): string[] {
  return [...new Set(rules.flatMap((r) => pick(r.actions)))]
}

const one = (id: string | undefined): string[] => (id === undefined ? [] : [id])

/** The categories, counterparties and tags the rules' actions name: one `getAll` each, none when nothing is named. */
export async function readTargets(db: Firestore, orgId: string, rules: readonly Rule[]): Promise<ActionTargets> {
  const categoryIds = idsOf(rules, (a) => one(a.categoryId))
  const counterpartyIds = idsOf(rules, (a) => one(a.counterpartyId))
  const tagIds = idsOf(rules, (a) => a.tagIds ?? [])
  const [categorySnaps, counterpartySnaps, tagSnaps] = await Promise.all([
    categoryIds.length === 0 ? Promise.resolve([]) : db.getAll(...categoryIds.map((id) => categoriesCol(db, orgId).doc(id))),
    counterpartyIds.length === 0 ? Promise.resolve([]) : db.getAll(...counterpartyIds.map((id) => counterpartiesCol(db, orgId).doc(id))),
    tagIds.length === 0 ? Promise.resolve([]) : db.getAll(...tagIds.map((id) => tagsCol(db, orgId).doc(id))),
  ])
  const categories = new Map<string, RuleType>()
  for (const s of categorySnaps) {
    const type: unknown = s.get('type')
    if (s.exists && (type === 'income' || type === 'expense')) categories.set(s.id, type)
  }
  const counterparties = new Map<string, { archived: boolean }>()
  for (const s of counterpartySnaps) if (s.exists) counterparties.set(s.id, { archived: s.get('archived') === true })
  const tags = new Map<string, { archived: boolean }>()
  for (const s of tagSnaps) if (s.exists) tags.set(s.id, { archived: s.get('archived') === true })
  return { categories, counterparties, tags }
}

/** `GET /rules`: every rule in order, with the actions that cannot work now. */
export async function listRules(db: Firestore, orgId: string): Promise<ListedRule[]> {
  const rules = await readRules(db, orgId)
  if (rules.length === 0) return []
  const targets = await readTargets(db, orgId, rules)
  return rules.map((rule) => ({ ...rule, unusable: unusableActions(rule, targets) }))
}

/** What a sync step or an apply step works with: the active rules, their unusable actions removed. */
export async function loadUsableRules(db: Firestore, orgId: string): Promise<Rule[]> {
  const active = (await readRules(db, orgId)).filter((r) => r.active)
  if (active.length === 0) return []
  return withoutUnusableActions(active, await readTargets(db, orgId, active))
}
