import type { ActionTargets, Rule, RuleActions, UnusableAction } from './types'

/** The actions of a rule that cannot work now (shown as «неробоче»); [] when both can. */
export function unusableActions(rule: Pick<Rule, 'type' | 'actions'>, targets: ActionTargets): UnusableAction[] {
  const out: UnusableAction[] = []
  const { categoryId, counterpartyId } = rule.actions
  if (categoryId !== undefined && targets.categories.get(categoryId) !== rule.type) out.push('category')
  if (counterpartyId !== undefined) {
    const counterparty = targets.counterparties.get(counterpartyId)
    if (counterparty === undefined || counterparty.archived) out.push('counterparty')
  }
  return out
}

/** The rules with their unusable actions removed: the other action of such a rule still works. */
export function withoutUnusableActions(rules: readonly Rule[], targets: ActionTargets): Rule[] {
  return rules.map((rule) => {
    const unusable = unusableActions(rule, targets)
    if (unusable.length === 0) return rule
    const actions: RuleActions = { ...rule.actions }
    if (unusable.includes('category')) delete actions.categoryId
    if (unusable.includes('counterparty')) delete actions.counterpartyId
    return { ...rule, actions }
  })
}
