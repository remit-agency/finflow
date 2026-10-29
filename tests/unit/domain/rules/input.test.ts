import { describe, expect, it } from 'vitest'
import { encodeCursor } from '@/lib/domain/journal/order'
import { RuleError } from '@/lib/domain/rules/errors'
import { parseApplyRequest, parseOrderRequest, parsePreviewRequest, parseRuleInput, parseRulePatch, withCurrency } from '@/lib/domain/rules/input'

const VALID = {
  name: '  Paliwo   ORLEN ',
  type: 'expense',
  conditions: [{ kind: 'text', op: 'contains', values: [' ORLEN ', 'BP-STACJA'] }],
  actions: { categoryId: 'k-fuel' },
}

function field(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof RuleError && e.code === 'invalid_input') return e.field
    throw e
  }
  return undefined
}

describe('parseRuleInput', () => {
  it('cleans the name and the words and makes a new rule active', () => {
    expect(parseRuleInput(VALID)).toEqual({
      name: 'Paliwo ORLEN',
      type: 'expense',
      active: true,
      conditions: [{ kind: 'text', op: 'contains', values: ['ORLEN', 'BP-STACJA'] }],
      actions: { categoryId: 'k-fuel' },
    })
  })

  it('reads every kind of condition and both actions', () => {
    const out = parseRuleInput({
      ...VALID,
      active: false,
      conditions: [
        { kind: 'text', op: 'notContains', values: ['zwrot'] },
        { kind: 'text', op: 'equals', values: ['Czynsz'] },
        { kind: 'account', accountIds: ['a1', 'a2'] },
        { kind: 'amount', currency: 'EUR', minMinor: 0, maxMinor: 5000 },
        { kind: 'amount', maxMinor: 100 },
      ],
      actions: { categoryId: 'k-fuel', counterpartyId: 'cp1' },
    })
    expect(out.active).toBe(false)
    expect(out.conditions).toEqual([
      { kind: 'text', op: 'notContains', values: ['zwrot'] },
      { kind: 'text', op: 'equals', values: ['Czynsz'] },
      { kind: 'account', accountIds: ['a1', 'a2'] },
      { kind: 'amount', currency: 'EUR', minMinor: 0, maxMinor: 5000 },
      { kind: 'amount', maxMinor: 100 },
    ])
    expect(out.actions).toEqual({ categoryId: 'k-fuel', counterpartyId: 'cp1' })
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['no name', { name: '   ' }, 'name'],
    ['a name over 100 characters', { name: 'x'.repeat(101) }, 'name'],
    ['a transfer rule', { type: 'transfer' }, 'type'],
    ['active that is not a boolean', { active: 'yes' }, 'active'],
    ['no conditions', { conditions: [] }, 'conditions'],
    ['11 conditions', { conditions: Array.from({ length: 11 }, () => ({ kind: 'text', op: 'contains', values: ['a'] })) }, 'conditions'],
    ['an unknown kind', { conditions: [{ kind: 'date' }] }, 'conditions.0.kind'],
    ['an unknown operator', { conditions: [{ kind: 'text', op: 'startsWith', values: ['a'] }] }, 'conditions.0.op'],
    ['an empty word list', { conditions: [{ kind: 'text', op: 'contains', values: [] }] }, 'conditions.0.values'],
    ['21 words', { conditions: [{ kind: 'text', op: 'contains', values: Array.from({ length: 21 }, (_, i) => `w${i}`) }] }, 'conditions.0.values'],
    ['a word over 80 characters', { conditions: [{ kind: 'text', op: 'contains', values: ['x'.repeat(81)] }] }, 'conditions.0.values'],
    ['a word with no letter or digit', { conditions: [{ kind: 'text', op: 'contains', values: ['!!!'] }] }, 'conditions.0.values'],
    ['a word that is not text', { conditions: [{ kind: 'text', op: 'contains', values: [5] }] }, 'conditions.0.values'],
    ['an extra key in a condition', { conditions: [{ kind: 'text', op: 'contains', values: ['a'], extra: 1 }] }, 'conditions.0.extra'],
    ['no accounts', { conditions: [{ kind: 'account', accountIds: [] }] }, 'conditions.0.accountIds'],
    ['21 accounts', { conditions: [{ kind: 'account', accountIds: Array.from({ length: 21 }, (_, i) => `a${i}`) }] }, 'conditions.0.accountIds'],
    ['the same account twice', { conditions: [{ kind: 'account', accountIds: ['a1', 'a1'] }] }, 'conditions.0.accountIds'],
    ['an account id with a slash', { conditions: [{ kind: 'account', accountIds: ['a/b'] }] }, 'conditions.0.accountIds'],
    ['a currency the ledger does not keep', { conditions: [{ kind: 'amount', currency: 'GBP', minMinor: 1 }] }, 'conditions.0.currency'],
    ['an amount without bounds', { conditions: [{ kind: 'amount', currency: 'PLN' }] }, 'conditions.0.minMinor'],
    ['a negative bound', { conditions: [{ kind: 'amount', minMinor: -1 }] }, 'conditions.0.minMinor'],
    ['a fractional bound', { conditions: [{ kind: 'amount', maxMinor: 1.5 }] }, 'conditions.0.maxMinor'],
    ['min above max', { conditions: [{ kind: 'amount', minMinor: 200, maxMinor: 100 }] }, 'conditions.0.maxMinor'],
    ['no action', { actions: {} }, 'actions'],
    ['an unknown action', { actions: { projectId: 'p1' } }, 'actions.projectId'],
    ['a category id that is not an id', { actions: { categoryId: '' } }, 'actions.categoryId'],
    ['a counterparty id that is not an id', { actions: { counterpartyId: '__x__' } }, 'actions.counterpartyId'],
    ['an unknown top-level key', { order: 3 }, 'order'],
  ])('refuses %s', (_name, over, expected) => {
    expect(field(() => parseRuleInput({ ...VALID, ...over }))).toBe(expected)
  })

  it('refuses a body that is not an object', () => {
    expect(field(() => parseRuleInput(null))).toBe('body')
    expect(field(() => parseRuleInput([]))).toBe('body')
  })
})

describe('parseRulePatch', () => {
  it('takes only what is given', () => {
    expect(parseRulePatch({ active: false })).toEqual({ active: false })
    expect(parseRulePatch({ name: ' Nowa ', type: 'income' })).toEqual({ name: 'Nowa', type: 'income' })
    expect(parseRulePatch({ conditions: [{ kind: 'amount', minMinor: 1 }], actions: { counterpartyId: 'cp1' } })).toEqual({
      conditions: [{ kind: 'amount', minMinor: 1 }],
      actions: { counterpartyId: 'cp1' },
    })
  })

  it('refuses an empty patch and validates each field like a create', () => {
    expect(field(() => parseRulePatch({}))).toBe('body')
    expect(field(() => parseRulePatch({ active: 1 }))).toBe('active')
    expect(field(() => parseRulePatch({ conditions: [] }))).toBe('conditions')
    expect(field(() => parseRulePatch({ actions: {} }))).toBe('actions')
    expect(field(() => parseRulePatch({ order: 1 }))).toBe('order')
  })
})

describe('withCurrency', () => {
  it('gives an amount condition without a currency the company currency and leaves the rest', () => {
    const { conditions } = parseRuleInput({
      ...VALID,
      conditions: [{ kind: 'amount', maxMinor: 100 }, { kind: 'amount', currency: 'EUR', minMinor: 1 }, { kind: 'text', op: 'contains', values: ['a'] }],
    })
    expect(withCurrency(conditions, 'PLN')).toEqual([
      { kind: 'amount', currency: 'PLN', maxMinor: 100 },
      { kind: 'amount', currency: 'EUR', minMinor: 1 },
      { kind: 'text', op: 'contains', values: ['a'] },
    ])
  })
})

describe('parseOrderRequest', () => {
  it('reads the ids', () => {
    expect(parseOrderRequest({ ids: ['r2', 'r1'] })).toEqual({ ids: ['r2', 'r1'] })
  })

  it.each<[unknown, string]>([
    [{ ids: [] }, 'ids'],
    [{ ids: ['r1', 'r1'] }, 'ids'],
    [{ ids: ['a/b'] }, 'ids'],
    [{ ids: Array.from({ length: 51 }, (_, i) => `r${i}`) }, 'ids'],
    [{ ids: 'r1' }, 'ids'],
    [{ ids: ['r1'], x: 1 }, 'x'],
  ])('refuses %j', (body, expected) => {
    expect(field(() => parseOrderRequest(body))).toBe(expected)
  })
})

describe('parseApplyRequest', () => {
  const key = { paymentDate: '2026-10-20', createdAtS: 1_790_000_000, createdAtN: 5, id: 't1' }

  it('reads the mode and an optional cursor', () => {
    expect(parseApplyRequest({ mode: 'check' })).toEqual({ mode: 'check', cursor: null })
    expect(parseApplyRequest({ mode: 'apply', cursor: encodeCursor(key) })).toEqual({ mode: 'apply', cursor: key })
  })

  it.each<[unknown, string]>([
    [{}, 'mode'],
    [{ mode: 'run' }, 'mode'],
    [{ mode: 'check', cursor: 'not-a-cursor' }, 'cursor'],
    [{ mode: 'check', cursor: 5 }, 'cursor'],
    [{ mode: 'check', extra: 1 }, 'extra'],
  ])('refuses %j', (body, expected) => {
    expect(field(() => parseApplyRequest(body))).toBe(expected)
  })
})

describe('parsePreviewRequest', () => {
  it('validates the rule like a create', () => {
    expect(parsePreviewRequest({ rule: VALID }).rule.name).toBe('Paliwo ORLEN')
    expect(field(() => parsePreviewRequest({ rule: { ...VALID, conditions: [] } }))).toBe('conditions')
    expect(field(() => parsePreviewRequest({}))).toBe('body')
  })
})
