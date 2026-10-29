import { parseRuleInput, type RuleInput } from '@/lib/domain/rules/input'

/** A valid rule body: «Paliwo», expense, a text contains "orlen", category k-fuel. `over` replaces whole fields. */
export function ruleInput(over: Record<string, unknown> = {}): RuleInput {
  return parseRuleInput({
    name: 'Paliwo',
    type: 'expense',
    conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }],
    actions: { categoryId: 'k-fuel' },
    ...over,
  })
}
