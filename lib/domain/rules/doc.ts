import { isMinor } from '@/lib/domain/ledger/money'
import {
  MAX_CONDITIONS,
  RULE_TYPES,
  TEXT_OPS,
  type AmountCondition,
  type Rule,
  type RuleActions,
  type RuleCondition,
  type RuleType,
  type TextOp,
} from './types'

export const RULE_SCHEMA_VERSION = 1

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonEmptyStrings(v: unknown): string[] | null {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== '') ? [...(v as string[])] : null
}

function conditionToDoc(c: RuleCondition): Record<string, unknown> {
  if (c.kind === 'text') return { kind: 'text', op: c.op, values: [...c.values] }
  if (c.kind === 'account') return { kind: 'account', accountIds: [...c.accountIds] }
  const doc: Record<string, unknown> = { kind: 'amount', currency: c.currency }
  if (c.minMinor !== undefined) doc.minMinor = c.minMinor
  if (c.maxMinor !== undefined) doc.maxMinor = c.maxMinor
  return doc
}

/** The stored fields of a rule (no id, no timestamps, no orgId: the writer adds those). Never contains `undefined`. */
export function ruleToDoc(rule: Rule): Record<string, unknown> {
  const actions: Record<string, string> = {}
  if (rule.actions.categoryId !== undefined) actions.categoryId = rule.actions.categoryId
  if (rule.actions.counterpartyId !== undefined) actions.counterpartyId = rule.actions.counterpartyId
  return {
    schemaVersion: RULE_SCHEMA_VERSION,
    name: rule.name,
    type: rule.type,
    active: rule.active,
    order: rule.order,
    conditions: rule.conditions.map(conditionToDoc),
    actions,
  }
}

function bound(v: unknown): number | undefined | null {
  if (v === undefined) return undefined
  return isMinor(v) && v >= 0 ? v : null
}

function parseCondition(v: unknown): RuleCondition | null {
  if (!isRecord(v)) return null
  if (v.kind === 'text') {
    const values = nonEmptyStrings(v.values)
    if (!(TEXT_OPS as readonly unknown[]).includes(v.op) || values === null) return null
    return { kind: 'text', op: v.op as TextOp, values }
  }
  if (v.kind === 'account') {
    const accountIds = nonEmptyStrings(v.accountIds)
    return accountIds === null ? null : { kind: 'account', accountIds }
  }
  if (v.kind === 'amount') {
    if (typeof v.currency !== 'string' || v.currency === '') return null
    const minMinor = bound(v.minMinor)
    const maxMinor = bound(v.maxMinor)
    if (minMinor === null || maxMinor === null || (minMinor === undefined && maxMinor === undefined)) return null
    const c: AmountCondition = { kind: 'amount', currency: v.currency }
    if (minMinor !== undefined) c.minMinor = minMinor
    if (maxMinor !== undefined) c.maxMinor = maxMinor
    return c
  }
  return null
}

function parseActions(v: unknown): RuleActions | null {
  if (!isRecord(v)) return null
  const out: RuleActions = {}
  for (const key of ['categoryId', 'counterpartyId'] as const) {
    const value = v[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value === '') return null
    out[key] = value
  }
  return out.categoryId === undefined && out.counterpartyId === undefined ? null : out
}

/** Milliseconds of a Firestore Timestamp (anything with a `toMillis` method), 0 otherwise. */
function millisOf(v: unknown): number {
  if (!isRecord(v) || typeof v.toMillis !== 'function') return 0
  const ms: unknown = (v as { toMillis: () => unknown }).toMillis()
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : 0
}

/** Strict reader: null for a document that is not a schema 1 rule (such a document is never listed or applied). */
export function parseRule(id: string, data: unknown): Rule | null {
  if (!isRecord(data) || data.schemaVersion !== RULE_SCHEMA_VERSION) return null
  const { name, type, active, order } = data
  if (typeof name !== 'string' || name === '' || !(RULE_TYPES as readonly unknown[]).includes(type)) return null
  if (typeof active !== 'boolean' || typeof order !== 'number' || !Number.isSafeInteger(order)) return null
  if (!Array.isArray(data.conditions) || data.conditions.length === 0 || data.conditions.length > MAX_CONDITIONS) return null
  const conditions: RuleCondition[] = []
  for (const c of data.conditions) {
    const parsed = parseCondition(c)
    if (parsed === null) return null
    conditions.push(parsed)
  }
  const actions = parseActions(data.actions)
  if (actions === null) return null
  return { id, name, type: type as RuleType, active, order, conditions, actions, createdAtMs: millisOf(data.createdAt) }
}
