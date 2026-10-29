import { decodeCursor, type JournalKey } from '@/lib/domain/journal/order'
import { isId } from '@/lib/domain/ledger/guards'
import { MAX_MINOR, isMinor } from '@/lib/domain/ledger/money'
import { LEDGER_CURRENCIES } from '@/lib/domain/ledger/types'
import { asRecord, bad, onlyKeys } from './guards'
import { normalizeRuleText } from './normalize'
import {
  MAX_CONDITIONS,
  MAX_RULE_ACCOUNTS,
  MAX_RULES,
  MAX_VALUES,
  RULE_NAME_MAX,
  RULE_TYPES,
  TEXT_OPS,
  VALUE_MAX,
  type AccountCondition,
  type RuleActions,
  type RuleCondition,
  type RuleType,
  type TextCondition,
  type TextOp,
} from './types'

/** An amount condition as a request may send it: without a currency it takes the company currency (`withCurrency`). */
export interface AmountConditionInput {
  kind: 'amount'
  currency?: string
  minMinor?: number
  maxMinor?: number
}

export type RuleConditionInput = TextCondition | AccountCondition | AmountConditionInput

/** A validated create (and preview) request. */
export interface RuleInput {
  name: string
  type: RuleType
  active: boolean
  conditions: RuleConditionInput[]
  actions: RuleActions
}

/** A validated PATCH: only the fields given, at least one. `actions` replaces both actions. */
export interface RulePatch {
  name?: string
  type?: RuleType
  active?: boolean
  conditions?: RuleConditionInput[]
  actions?: RuleActions
}

const RULE_KEYS = ['name', 'type', 'active', 'conditions', 'actions'] as const

function ruleName(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.replace(/\s+/g, ' ').trim()
  if (text.length < 1 || text.length > RULE_NAME_MAX) bad('name')
  return text
}

function ruleType(v: unknown): RuleType {
  if (!(RULE_TYPES as readonly unknown[]).includes(v)) bad('type')
  return v as RuleType
}

function active(v: unknown): boolean {
  if (typeof v !== 'boolean') bad('active')
  return v
}

function words(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_VALUES) bad(field)
  return v.map((item) => {
    if (typeof item !== 'string') bad(field)
    const text = item.replace(/\s+/g, ' ').trim()
    // A word with no letter or digit would match everything after normalisation.
    if (text.length < 1 || text.length > VALUE_MAX || normalizeRuleText(text) === '') bad(field)
    return text
  })
}

function bound(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined
  if (!isMinor(v) || v < 0 || v > MAX_MINOR) bad(field)
  return v
}

function condition(v: unknown, i: number): RuleConditionInput {
  const p = `conditions.${i}.`
  const r = asRecord(v, `conditions.${i}`)
  if (r.kind === 'text') {
    onlyKeys(r, ['kind', 'op', 'values'], p)
    if (!(TEXT_OPS as readonly unknown[]).includes(r.op)) bad(`${p}op`)
    return { kind: 'text', op: r.op as TextOp, values: words(r.values, `${p}values`) }
  }
  if (r.kind === 'account') {
    onlyKeys(r, ['kind', 'accountIds'], p)
    const ids = r.accountIds
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_RULE_ACCOUNTS) bad(`${p}accountIds`)
    if (!ids.every((id) => isId(id)) || new Set(ids).size !== ids.length) bad(`${p}accountIds`)
    return { kind: 'account', accountIds: ids as string[] }
  }
  if (r.kind === 'amount') {
    onlyKeys(r, ['kind', 'currency', 'minMinor', 'maxMinor'], p)
    if (r.currency !== undefined && !(LEDGER_CURRENCIES as readonly unknown[]).includes(r.currency)) bad(`${p}currency`)
    const minMinor = bound(r.minMinor, `${p}minMinor`)
    const maxMinor = bound(r.maxMinor, `${p}maxMinor`)
    if (minMinor === undefined && maxMinor === undefined) bad(`${p}minMinor`)
    if (minMinor !== undefined && maxMinor !== undefined && minMinor > maxMinor) bad(`${p}maxMinor`)
    const out: AmountConditionInput = { kind: 'amount' }
    if (r.currency !== undefined) out.currency = r.currency as string
    if (minMinor !== undefined) out.minMinor = minMinor
    if (maxMinor !== undefined) out.maxMinor = maxMinor
    return out
  }
  return bad(`${p}kind`)
}

function conditions(v: unknown): RuleConditionInput[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_CONDITIONS) bad('conditions')
  return v.map((c, i) => condition(c, i))
}

function actions(v: unknown): RuleActions {
  const r = asRecord(v, 'actions')
  onlyKeys(r, ['categoryId', 'counterpartyId'], 'actions.')
  const out: RuleActions = {}
  if (r.categoryId !== undefined) {
    if (!isId(r.categoryId)) bad('actions.categoryId')
    out.categoryId = r.categoryId
  }
  if (r.counterpartyId !== undefined) {
    if (!isId(r.counterpartyId)) bad('actions.counterpartyId')
    out.counterpartyId = r.counterpartyId
  }
  if (out.categoryId === undefined && out.counterpartyId === undefined) bad('actions')
  return out
}

export function parseRuleInput(body: unknown): RuleInput {
  const r = asRecord(body)
  onlyKeys(r, RULE_KEYS)
  return {
    name: ruleName(r.name),
    type: ruleType(r.type),
    active: r.active === undefined ? true : active(r.active),
    conditions: conditions(r.conditions),
    actions: actions(r.actions),
  }
}

export function parseRulePatch(body: unknown): RulePatch {
  const r = asRecord(body)
  onlyKeys(r, RULE_KEYS)
  if (Object.keys(r).length === 0) bad('body')
  const out: RulePatch = {}
  if (r.name !== undefined) out.name = ruleName(r.name)
  if (r.type !== undefined) out.type = ruleType(r.type)
  if (r.active !== undefined) out.active = active(r.active)
  if (r.conditions !== undefined) out.conditions = conditions(r.conditions)
  if (r.actions !== undefined) out.actions = actions(r.actions)
  return out
}

/** The stored conditions: an amount condition without a currency takes the company currency. */
export function withCurrency(list: readonly RuleConditionInput[], baseCurrency: string): RuleCondition[] {
  return list.map((c) => (c.kind === 'amount' ? { ...c, currency: c.currency ?? baseCurrency } : c))
}

/** `POST /rules/order`: all the company's rule ids in the new order. */
export function parseOrderRequest(body: unknown): { ids: string[] } {
  const r = asRecord(body)
  onlyKeys(r, ['ids'])
  const ids = r.ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_RULES) bad('ids')
  if (!ids.every((id) => isId(id)) || new Set(ids).size !== ids.length) bad('ids')
  return { ids: ids as string[] }
}

export type ApplyMode = 'check' | 'apply'

/** `POST /rules/apply`: the mode and the cursor of the previous step (absent on the first one). */
export function parseApplyRequest(body: unknown): { mode: ApplyMode; cursor: JournalKey | null } {
  const r = asRecord(body)
  onlyKeys(r, ['mode', 'cursor'])
  if (r.mode !== 'check' && r.mode !== 'apply') bad('mode')
  const mode = r.mode as ApplyMode
  if (r.cursor === undefined) return { mode, cursor: null }
  const cursor = typeof r.cursor === 'string' ? decodeCursor(r.cursor) : null
  if (cursor === null) bad('cursor')
  return { mode, cursor }
}

/** `POST /rules/preview`: a draft rule, validated like a create. */
export function parsePreviewRequest(body: unknown): { rule: RuleInput } {
  const r = asRecord(body)
  onlyKeys(r, ['rule'])
  return { rule: parseRuleInput(r.rule) }
}
