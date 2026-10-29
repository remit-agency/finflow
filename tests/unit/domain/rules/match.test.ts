import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { applyRules, ruleMatches, ruleOperationOf, sortRules } from '@/lib/domain/rules/match'
import type { Rule, RuleCondition, RuleOperation, TextOp } from '@/lib/domain/rules/types'

const op = (over: Partial<RuleOperation> = {}): RuleOperation => ({
  type: 'expense',
  accountId: 'a1',
  currency: 'PLN',
  amountMinor: 12_345,
  remittance: 'Płatność kartą ORLEN STACJA 123',
  bankName: 'PKN ORLEN S.A.',
  ...over,
})

const rule = (id: string, conditions: RuleCondition[], over: Partial<Rule> = {}): Rule => ({
  id,
  name: `Rule ${id}`,
  type: 'expense',
  active: true,
  order: 0,
  createdAtMs: 0,
  conditions,
  actions: { categoryId: `k-${id}` },
  ...over,
})

const text = (textOp: TextOp, ...values: string[]): RuleCondition => ({ kind: 'text', op: textOp, values })
const matches = (c: RuleCondition, o: RuleOperation = op()) => ruleMatches(rule('x', [c]), o)

describe('text conditions', () => {
  it('contains: any word inside any of the texts, case and diacritics ignored', () => {
    expect(matches(text('contains', 'orlen'))).toBe(true)
    expect(matches(text('contains', 'shell', 'Stacja 123'))).toBe(true)
    expect(matches(text('contains', 'PŁATNOŚĆ KARTĄ'))).toBe(true)
    expect(matches(text('contains', 'shell'))).toBe(false)
  })

  it('contains looks in the comment too', () => {
    expect(matches(text('contains', 'faktura'), op({ remittance: undefined, bankName: undefined, description: 'Faktura FV/1/2026' }))).toBe(true)
  })

  it('a word does not run across two texts', () => {
    // "pkn orlen s a" and "platnosc karta ...": "s a platnosc" spans the two.
    expect(matches(text('contains', 's.a. płatność'))).toBe(false)
  })

  it('notContains: none of the words in any text', () => {
    expect(matches(text('notContains', 'zwrot', 'shell'))).toBe(true)
    expect(matches(text('notContains', 'zwrot', 'orlen'))).toBe(false)
  })

  it('equals: one whole text equals one word', () => {
    expect(matches(text('equals', 'pkn orlen s.a.'))).toBe(true)
    expect(matches(text('equals', 'orlen'))).toBe(false)
    expect(matches(text('equals', 'Czynsz'), op({ remittance: 'CZYNSZ', bankName: undefined }))).toBe(true)
  })

  it('an operation without any text: contains and equals never hold, notContains always does', () => {
    const silent = op({ remittance: undefined, bankName: undefined, description: undefined })
    expect(matches(text('contains', 'orlen'), silent)).toBe(false)
    expect(matches(text('equals', 'orlen'), silent)).toBe(false)
    expect(matches(text('notContains', 'orlen'), silent)).toBe(true)
  })

  it('a text of punctuation only counts as no text', () => {
    expect(matches(text('notContains', 'orlen'), op({ remittance: '***', bankName: '-' }))).toBe(true)
  })
})

describe('account and amount conditions', () => {
  it('account: the operation account is in the list', () => {
    expect(matches({ kind: 'account', accountIds: ['a2', 'a1'] })).toBe(true)
    expect(matches({ kind: 'account', accountIds: ['a2'] })).toBe(false)
  })

  it('amount: the bounds are inclusive and in minor units', () => {
    expect(matches({ kind: 'amount', currency: 'PLN', minMinor: 12_345 })).toBe(true)
    expect(matches({ kind: 'amount', currency: 'PLN', maxMinor: 12_345 })).toBe(true)
    expect(matches({ kind: 'amount', currency: 'PLN', minMinor: 12_346 })).toBe(false)
    expect(matches({ kind: 'amount', currency: 'PLN', maxMinor: 12_344 })).toBe(false)
    expect(matches({ kind: 'amount', currency: 'PLN', minMinor: 10_000, maxMinor: 20_000 })).toBe(true)
  })

  it('amount: only an operation in the same currency, never converted', () => {
    expect(matches({ kind: 'amount', currency: 'EUR', minMinor: 1 })).toBe(false)
    expect(matches({ kind: 'amount', currency: 'EUR', minMinor: 1 }, op({ currency: 'EUR' }))).toBe(true)
  })
})

describe('ruleMatches', () => {
  it('every condition must hold', () => {
    expect(ruleMatches(rule('x', [text('contains', 'orlen'), { kind: 'account', accountIds: ['a1'] }]), op())).toBe(true)
    expect(ruleMatches(rule('x', [text('contains', 'orlen'), { kind: 'account', accountIds: ['a2'] }]), op())).toBe(false)
  })

  it('the rule type must be the operation type, and an inactive rule never matches', () => {
    expect(ruleMatches(rule('x', [text('contains', 'orlen')], { type: 'income' }), op())).toBe(false)
    expect(ruleMatches(rule('x', [text('contains', 'orlen')], { active: false }), op())).toBe(false)
    expect(ruleMatches(rule('x', [text('contains', 'orlen')]), op({ type: 'transfer' }))).toBe(false)
  })
})

describe('sortRules', () => {
  it('orders by order, then creation time, then id, without touching the input', () => {
    const list = [
      rule('c', [], { order: 1, createdAtMs: 5 }),
      rule('b', [], { order: 0, createdAtMs: 9 }),
      rule('a', [], { order: 1, createdAtMs: 5 }),
      rule('d', [], { order: 1, createdAtMs: 1 }),
    ]
    expect(sortRules(list).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(list.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd'])
  })
})

describe('applyRules', () => {
  const orlen = text('contains', 'orlen')

  it('the first matching rule with an action fills each empty field, and later ones fill the rest', () => {
    const rules = [
      rule('late', [orlen], { order: 2, actions: { categoryId: 'k-late', counterpartyId: 'cp-late' } }),
      rule('first', [orlen], { order: 0, actions: { categoryId: 'k-first' } }),
      rule('second', [orlen], { order: 1, actions: { counterpartyId: 'cp-second' } }),
    ]
    expect(applyRules(rules, op())).toEqual({
      categoryId: 'k-first',
      counterpartyId: 'cp-second',
      applied: [{ id: 'first', name: 'Rule first' }, { id: 'second', name: 'Rule second' }],
    })
  })

  it('never replaces a field that is already set, and lists only rules that filled something', () => {
    const rules = [rule('a', [orlen], { actions: { categoryId: 'k-a', counterpartyId: 'cp-a' } })]
    expect(applyRules(rules, op({ categoryId: 'k-mine' }))).toEqual({ counterpartyId: 'cp-a', applied: [{ id: 'a', name: 'Rule a' }] })
    expect(applyRules(rules, op({ categoryId: 'k-mine', counterpartyId: 'cp-mine' }))).toEqual({ applied: [] })
  })

  it('a matching rule whose action has nothing left to fill is not listed', () => {
    const rules = [rule('a', [orlen], { order: 0 }), rule('b', [orlen], { order: 1, actions: { categoryId: 'k-b' } })]
    expect(applyRules(rules, op()).applied).toEqual([{ id: 'a', name: 'Rule a' }])
  })

  it('skips inactive rules and rules of the other type, and gives a transfer nothing', () => {
    const rules = [rule('off', [orlen], { active: false }), rule('inc', [orlen], { type: 'income' }), rule('on', [orlen], { order: 5 })]
    expect(applyRules(rules, op()).categoryId).toBe('k-on')
    expect(applyRules(rules, op({ type: 'transfer' }))).toEqual({ applied: [] })
  })

  it('a rule without actions does nothing', () => {
    expect(applyRules([rule('a', [orlen], { actions: {} })], op())).toEqual({ applied: [] })
  })
})

describe('ruleOperationOf', () => {
  it('takes the texts from the bank block and the comment, and the fields that are set', () => {
    const tx: LedgerTransaction = {
      id: 't1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 500, currency: 'EUR',
      paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
      description: 'Kawa', counterpartyId: 'cp1', bank: { accountRef: 'ba1', remittance: 'Kawiarnia 1', counterpartyName: 'KAWA SP' },
    }
    expect(ruleOperationOf(tx)).toEqual({
      type: 'expense', accountId: 'a1', currency: 'EUR', amountMinor: 500,
      remittance: 'Kawiarnia 1', bankName: 'KAWA SP', description: 'Kawa', counterpartyId: 'cp1',
    })
  })
})
