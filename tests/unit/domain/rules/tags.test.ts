import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { parseRule, ruleToDoc } from '@/lib/domain/rules/doc'
import { RuleError } from '@/lib/domain/rules/errors'
import { parseRuleInput } from '@/lib/domain/rules/input'
import { applyRules, ruleOperationOf } from '@/lib/domain/rules/match'
import type { ActionTargets, Rule, RuleOperation } from '@/lib/domain/rules/types'
import { unusableActions, withoutUnusableActions } from '@/lib/domain/rules/usable'

const BODY = { name: 'ПДВ', type: 'expense', conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }] }

function field(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof RuleError && e.code === 'invalid_input') return e.field
    throw e
  }
  return undefined
}

const rule = (id: string, over: Partial<Rule> = {}): Rule => ({
  id,
  name: `Rule ${id}`,
  type: 'expense',
  active: true,
  order: Number(id.slice(1)),
  createdAtMs: 0,
  conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }],
  actions: { tagIds: ['vat'] },
  ...over,
})
const op = (over: Partial<RuleOperation> = {}): RuleOperation => ({ type: 'expense', accountId: 'a1', currency: 'PLN', amountMinor: 100, bankName: 'ORLEN', ...over })

describe('the tag action of a rule (S10t)', () => {
  it('is read alone or together with the other actions', () => {
    expect(parseRuleInput({ ...BODY, actions: { tagIds: ['vat'] } }).actions).toEqual({ tagIds: ['vat'] })
    expect(parseRuleInput({ ...BODY, actions: { categoryId: 'k', tagIds: ['vat', 'q4'] } }).actions).toEqual({ categoryId: 'k', tagIds: ['vat', 'q4'] })
  })

  it.each([
    ['an empty list', { tagIds: [] }],
    ['six tags', { tagIds: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['a repeat', { tagIds: ['a', 'a'] }],
    ['a path', { tagIds: ['a/b'] }],
  ])('refuses %s', (_label, actions) => {
    expect(field(() => parseRuleInput({ ...BODY, actions }))).toBe('actions.tagIds')
  })

  it('round-trips through the document; a malformed tag list makes the document malformed', () => {
    const stored = rule('r1', { name: 'ПДВ', order: 0 })
    expect(ruleToDoc(stored).actions).toEqual({ tagIds: ['vat'] })
    expect(parseRule('r1', ruleToDoc(stored))).toEqual(stored)
    expect(parseRule('r1', { ...ruleToDoc(stored), actions: { tagIds: ['a/b'] } })).toBeNull()
    expect(parseRule('r1', { ...ruleToDoc(stored), actions: { tagIds: [] } })).toBeNull()
  })
})

describe('an unusable tag action', () => {
  const targets: ActionTargets = {
    categories: new Map([['k-fuel', 'expense']]),
    counterparties: new Map(),
    tags: new Map([
      ['vat', { archived: false }],
      ['old', { archived: true }],
    ]),
  }

  it('is the whole action when one tag is gone or archived; the other actions still work', () => {
    const both = rule('r1', { actions: { categoryId: 'k-fuel', tagIds: ['vat', 'old'] } })
    expect(unusableActions(both, targets)).toEqual(['tags'])
    expect(unusableActions(rule('r1', { actions: { tagIds: ['ghost'] } }), targets)).toEqual(['tags'])
    expect(unusableActions(rule('r1', { actions: { tagIds: ['vat'] } }), targets)).toEqual([])
    expect(withoutUnusableActions([both], targets)[0].actions).toEqual({ categoryId: 'k-fuel' })
  })
})

describe('applyRules with tags', () => {
  it('adds the tags of every matching rule, in rule order, after the ones the operation has', () => {
    expect(applyRules([rule('r2', { actions: { tagIds: ['b', 'c'] } }), rule('r1', { actions: { tagIds: ['a', 'b'] } })], op({ tagIds: ['x'] }))).toEqual({
      tagIds: ['x', 'a', 'b', 'c'],
      applied: [
        { id: 'r1', name: 'Rule r1' },
        { id: 'r2', name: 'Rule r2' },
      ],
    })
  })

  it('never takes a tag off, and a rule that adds nothing new is not listed', () => {
    expect(applyRules([rule('r1', { actions: { tagIds: ['a'] } })], op({ tagIds: ['a'] }))).toEqual({ applied: [] })
  })

  it('stops at 10 tags', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`)
    expect(applyRules([rule('r1', { actions: { tagIds: ['x', 'y'] } })], op({ tagIds: nine })).tagIds).toEqual([...nine, 'x'])
    expect(applyRules([rule('r1', { actions: { tagIds: ['x'] } })], op({ tagIds: [...nine, 't9'] }))).toEqual({ applied: [] })
  })

  it('also works on an operation whose category and counterparty are set, and next to «first rule wins» for the fields', () => {
    const first = rule('r1', { actions: { categoryId: 'k1', tagIds: ['vat'] } })
    const second = rule('r2', { actions: { categoryId: 'k2', tagIds: ['q4'] } })
    expect(applyRules([first, second], op())).toEqual({
      categoryId: 'k1',
      tagIds: ['vat', 'q4'],
      applied: [
        { id: 'r1', name: 'Rule r1' },
        { id: 'r2', name: 'Rule r2' },
      ],
    })
    expect(applyRules([first], op({ categoryId: 'mine', counterpartyId: 'cp' }))).toEqual({ tagIds: ['vat'], applied: [{ id: 'r1', name: 'Rule r1' }] })
  })

  it('a transfer gets nothing', () => {
    expect(applyRules([rule('r1')], op({ type: 'transfer' }))).toEqual({ applied: [] })
  })

  it('ruleOperationOf carries the tags an operation has, and nothing for an untagged one', () => {
    const tx: LedgerTransaction = {
      id: 't1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 500, currency: 'PLN',
      paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: ['q4'], fileUrls: [],
    }
    expect(ruleOperationOf(tx).tagIds).toEqual(['q4'])
    expect('tagIds' in ruleOperationOf({ ...tx, tags: [] })).toBe(false)
  })
})
