import { describe, expect, it } from 'vitest'
import { RULE_SCHEMA_VERSION, parseRule, ruleToDoc } from '@/lib/domain/rules/doc'
import type { Rule } from '@/lib/domain/rules/types'

const rule: Rule = {
  id: 'r1', name: 'Paliwo', type: 'expense', active: true, order: 3, createdAtMs: 1_790_000_000_000,
  conditions: [
    { kind: 'text', op: 'contains', values: ['ORLEN', 'BP-STACJA'] },
    { kind: 'account', accountIds: ['a1'] },
    { kind: 'amount', currency: 'PLN', maxMinor: 50_000 },
  ],
  actions: { categoryId: 'k-fuel' },
}
/** What a Firestore Timestamp offers the reader. */
const stamp = (ms: number) => ({ toMillis: () => ms })

describe('rule documents', () => {
  it('round-trips a rule; the creation time comes from the timestamp', () => {
    const doc = ruleToDoc(rule)
    expect(doc).toEqual({ schemaVersion: RULE_SCHEMA_VERSION, name: 'Paliwo', type: 'expense', active: true, order: 3, conditions: rule.conditions, actions: { categoryId: 'k-fuel' } })
    expect(parseRule('r1', { ...doc, createdAt: stamp(rule.createdAtMs), orgId: 'org1' })).toEqual(rule)
  })

  it('a missing creation time reads as 0', () => {
    expect(parseRule('r1', ruleToDoc(rule))?.createdAtMs).toBe(0)
  })

  it('stores no absent bound or action (Firestore refuses undefined)', () => {
    const doc = ruleToDoc({ ...rule, conditions: [{ kind: 'amount', currency: 'EUR', minMinor: 1 }], actions: { counterpartyId: 'cp1' } })
    expect(doc.conditions).toEqual([{ kind: 'amount', currency: 'EUR', minMinor: 1 }])
    expect(doc.actions).toEqual({ counterpartyId: 'cp1' })
  })

  it.each<[string, Record<string, unknown>]>([
    ['another schema', { schemaVersion: 2 }],
    ['no name', { name: '' }],
    ['a transfer type', { type: 'transfer' }],
    ['a non-boolean active', { active: 'yes' }],
    ['a fractional order', { order: 1.5 }],
    ['no conditions', { conditions: [] }],
    ['an unknown condition kind', { conditions: [{ kind: 'date' }] }],
    ['an unknown operator', { conditions: [{ kind: 'text', op: 'like', values: ['a'] }] }],
    ['empty words', { conditions: [{ kind: 'text', op: 'contains', values: [] }] }],
    ['an amount without a currency', { conditions: [{ kind: 'amount', minMinor: 1 }] }],
    ['an amount without bounds', { conditions: [{ kind: 'amount', currency: 'PLN' }] }],
    ['no actions', { actions: {} }],
    ['a non-string action', { actions: { categoryId: 5 } }],
  ])('reads %s as not a rule', (_name, over) => {
    expect(parseRule('r1', { ...ruleToDoc(rule), ...over })).toBeNull()
  })

  it.each<[string, unknown]>([
    ['a slash in a category id', 'x/y'],
    ['a double slash in a category id', 'a//b'],
    ['an empty category id', ''],
    ['a reserved category id', '__x__'],
    ['a number as category id', 5],
  ])('reads %s as not a rule (a Firestore document path would throw)', (_name, categoryId) => {
    expect(parseRule('r1', { ...ruleToDoc(rule), actions: { categoryId } })).toBeNull()
  })

  it.each<[string, unknown]>([
    ['a slash in a counterparty id', 'a/b'],
    ['a double slash in a counterparty id', 'a//b'],
    ['an empty counterparty id', ''],
    ['a number as counterparty id', 7],
  ])('reads %s as not a rule', (_name, counterpartyId) => {
    expect(parseRule('r1', { ...ruleToDoc(rule), actions: { counterpartyId } })).toBeNull()
  })

  it.each<[string, unknown]>([
    ['a slash in an account id', 'a/b'],
    ['a double slash in an account id', 'a//b'],
    ['an empty account id', ''],
    ['a non-string account id', 3],
  ])('reads a rule with %s as not a rule', (_name, accountId) => {
    const conditions = [{ kind: 'account', accountIds: ['a1', accountId] }]
    expect(parseRule('r1', { ...ruleToDoc(rule), conditions })).toBeNull()
  })

  it('reads a rule whose ids are all valid', () => {
    const conditions = [{ kind: 'account', accountIds: ['acc-1', 'acc_2'] }]
    expect(parseRule('r1', { ...ruleToDoc(rule), conditions, actions: { categoryId: 'k-fuel', counterpartyId: 'cp-1' } })).not.toBeNull()
  })

  it('reads a non-object as not a rule', () => {
    expect(parseRule('r1', null)).toBeNull()
  })
})
