import { describe, expect, it } from 'vitest'
import { applyRules } from '@/lib/domain/rules/match'
import type { ActionTargets, Rule, RuleOperation, RuleType, UnusableAction } from '@/lib/domain/rules/types'
import { unusableActions, withoutUnusableActions } from '@/lib/domain/rules/usable'

const targets: ActionTargets = {
  categories: new Map<string, RuleType>([['k-fuel', 'expense'], ['k-sales', 'income']]),
  counterparties: new Map<string, { archived: boolean }>([['cp-orlen', { archived: false }], ['cp-old', { archived: true }]]),
}
const base: Rule = {
  id: 'r1', name: 'Paliwo', type: 'expense', active: true, order: 0, createdAtMs: 0,
  conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }],
  actions: { categoryId: 'k-fuel', counterpartyId: 'cp-orlen' },
}
const op: RuleOperation = { type: 'expense', accountId: 'a1', currency: 'PLN', amountMinor: 100, bankName: 'ORLEN' }

describe('unusableActions', () => {
  it('is empty while the category and the counterparty can be used', () => {
    expect(unusableActions(base, targets)).toEqual([])
  })

  it.each<[string, Rule['actions'], UnusableAction[]]>([
    ['a deleted category', { categoryId: 'k-gone' }, ['category']],
    ['a category of the other type', { categoryId: 'k-sales' }, ['category']],
    ['a deleted counterparty', { counterpartyId: 'cp-gone' }, ['counterparty']],
    ['an archived counterparty', { counterpartyId: 'cp-old' }, ['counterparty']],
    ['both', { categoryId: 'k-gone', counterpartyId: 'cp-old' }, ['category', 'counterparty']],
  ])('marks %s', (_name, actions, expected) => {
    expect(unusableActions({ ...base, actions }, targets)).toEqual(expected)
  })
})

describe('withoutUnusableActions', () => {
  it('drops only the action that cannot work; the other action of the rule still applies', () => {
    const [r] = withoutUnusableActions([{ ...base, actions: { categoryId: 'k-gone', counterpartyId: 'cp-orlen' } }], targets)
    expect(r.actions).toEqual({ counterpartyId: 'cp-orlen' })
    expect(applyRules([r], op)).toEqual({ counterpartyId: 'cp-orlen', applied: [{ id: 'r1', name: 'Paliwo' }] })
  })

  it('a rule left with no working action does nothing', () => {
    const [r] = withoutUnusableActions([{ ...base, actions: { categoryId: 'k-gone' } }], targets)
    expect(applyRules([r], op)).toEqual({ applied: [] })
  })

  it('returns a usable rule as it is', () => {
    expect(withoutUnusableActions([base], targets)[0]).toBe(base)
  })
})
