import { describe, expect, it } from 'vitest'
import { draftFromRule, draftToInput, emptyDraft, newCondition, splitValues, type RuleDraft } from '@/lib/api/rule-draft'
import type { Rule } from '@/lib/domain/rules/types'

const complete = (over: Partial<RuleDraft> = {}): RuleDraft => ({
  ...emptyDraft(),
  name: ' Paliwo ',
  conditions: [{ kind: 'text', op: 'contains', values: 'ORLEN, BP-STACJA ;Shell\n' }],
  categoryId: 'k-fuel',
  ...over,
})

describe('splitValues', () => {
  it('splits at commas, semicolons and line breaks and drops empty words', () => {
    expect(splitValues(' ORLEN, BP-STACJA ;Shell\n,, ')).toEqual(['ORLEN', 'BP-STACJA', 'Shell'])
    expect(splitValues('  ')).toEqual([])
  })
})

describe('draftToInput', () => {
  it('builds the request body of a complete draft', () => {
    expect(draftToInput(complete())).toEqual({
      name: 'Paliwo', type: 'expense', active: true,
      conditions: [{ kind: 'text', op: 'contains', values: ['ORLEN', 'BP-STACJA', 'Shell'] }],
      actions: { categoryId: 'k-fuel' },
    })
  })

  it('reads amounts as typed into minor units and leaves an unknown currency to the server', () => {
    const body = draftToInput(complete({
      conditions: [{ kind: 'amount', currency: 'PLN', min: '1 234,50', max: '' }, { kind: 'amount', currency: '', min: '', max: '10' }],
      categoryId: '',
      counterpartyId: 'cp1',
    }))
    expect(body?.conditions).toEqual([{ kind: 'amount', currency: 'PLN', minMinor: 123_450 }, { kind: 'amount', maxMinor: 1_000 }])
    expect(body?.actions).toEqual({ counterpartyId: 'cp1' })
  })

  it.each<[string, Partial<RuleDraft>]>([
    ['no name', { name: '  ' }],
    ['no action', { categoryId: '', counterpartyId: null }],
    ['no words', { conditions: [{ kind: 'text', op: 'contains', values: ' , ' }] }],
    ['no account picked', { conditions: [{ kind: 'account', accountIds: [] }] }],
    ['an amount without bounds', { conditions: [{ kind: 'amount', currency: 'PLN', min: '', max: '' }] }],
    ['an amount that is not a number', { conditions: [{ kind: 'amount', currency: 'PLN', min: 'abc', max: '' }] }],
    ['no conditions', { conditions: [] }],
  ])('is null for %s', (_name, over) => {
    expect(draftToInput(complete(over))).toBeNull()
  })
})

describe('draftFromRule', () => {
  it('fills the editor from a stored rule, amounts in the language of the UI, and gives the same body back', () => {
    const rule: Rule = {
      id: 'r1', name: 'Duże', type: 'income', active: false, order: 2, createdAtMs: 0,
      conditions: [
        { kind: 'text', op: 'equals', values: ['Czynsz', 'Najem'] },
        { kind: 'account', accountIds: ['a1'] },
        { kind: 'amount', currency: 'EUR', minMinor: 1_250 },
      ],
      actions: { categoryId: 'k-sales', counterpartyId: 'cp1' },
    }
    const draft = draftFromRule(rule, 'pl')
    expect(draft.conditions).toEqual([
      { kind: 'text', op: 'equals', values: 'Czynsz, Najem' },
      { kind: 'account', accountIds: ['a1'] },
      { kind: 'amount', currency: 'EUR', min: '12,5', max: '' },
    ])
    expect(draftToInput(draft)).toEqual({ name: 'Duże', type: 'income', active: false, conditions: rule.conditions, actions: rule.actions })
  })

  it('a new condition of each kind starts empty', () => {
    expect(newCondition('text', 'PLN')).toEqual({ kind: 'text', op: 'contains', values: '' })
    expect(newCondition('account', 'PLN')).toEqual({ kind: 'account', accountIds: [] })
    expect(newCondition('amount', 'PLN')).toEqual({ kind: 'amount', currency: 'PLN', min: '', max: '' })
  })
})

describe('tags (S10t)', () => {
  it('a rule with only tags is complete and sends them', () => {
    expect(draftToInput(complete({ categoryId: '', counterpartyId: null, tagIds: ['vat'] }))?.actions).toEqual({ tagIds: ['vat'] })
  })

  it('a new draft has no tags; a stored rule brings its own, not shared', () => {
    expect(emptyDraft().tagIds).toEqual([])
    const rule: Rule = {
      id: 'r1', name: 'ПДВ', type: 'expense', active: true, order: 0, createdAtMs: 0,
      conditions: [{ kind: 'text', op: 'contains', values: ['vat'] }], actions: { tagIds: ['vat', 'q4'] },
    }
    const draft = draftFromRule(rule, 'pl')
    expect(draft.tagIds).toEqual(['vat', 'q4'])
    draft.tagIds.push('x')
    expect(rule.actions.tagIds).toEqual(['vat', 'q4'])
    expect(draftToInput(draftFromRule(rule, 'pl'))?.actions).toEqual({ tagIds: ['vat', 'q4'] })
  })
})
