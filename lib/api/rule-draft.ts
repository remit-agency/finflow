import { fromMinor, toMinor } from '@/lib/domain/ledger/money'
import type { RuleConditionInput, RuleInput } from '@/lib/domain/rules/input'
import { MAX_VALUES, type Rule, type RuleType, type TextOp } from '@/lib/domain/rules/types'
import type { Locale } from '@/lib/i18n/config'
import { formatAmountInput, parseAmountInput } from '@/lib/utils/amount-input'

/** One condition as the editor holds it: the words and the amounts as typed. */
export type DraftCondition =
  | { kind: 'text'; op: TextOp; values: string }
  | { kind: 'account'; accountIds: string[] }
  | { kind: 'amount'; currency: string; min: string; max: string }

export interface RuleDraft {
  name: string
  type: RuleType
  active: boolean
  conditions: DraftCondition[]
  /** '' sets no category. */
  categoryId: string
  counterpartyId: string | null
}

/** An empty condition of a kind; an amount starts in `currency` (the company currency, '' while it loads). */
export function newCondition(kind: DraftCondition['kind'], currency: string): DraftCondition {
  if (kind === 'text') return { kind: 'text', op: 'contains', values: '' }
  if (kind === 'account') return { kind: 'account', accountIds: [] }
  return { kind: 'amount', currency, min: '', max: '' }
}

/** A new rule: an expense with one empty text condition (bank rules are mostly about expenses). */
export function emptyDraft(): RuleDraft {
  return { name: '', type: 'expense', active: true, conditions: [newCondition('text', '')], categoryId: '', counterpartyId: null }
}

/** The words of a text condition: split at commas, semicolons and line breaks, trimmed, empty ones dropped. */
export function splitValues(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter((v) => v !== '')
}

export function draftFromRule(rule: Rule, locale: Locale): RuleDraft {
  const amount = (minor: number | undefined) => (minor === undefined ? '' : formatAmountInput(fromMinor(minor), locale))
  return {
    name: rule.name,
    type: rule.type,
    active: rule.active,
    conditions: rule.conditions.map((c): DraftCondition => {
      if (c.kind === 'text') return { kind: 'text', op: c.op, values: c.values.join(', ') }
      if (c.kind === 'account') return { kind: 'account', accountIds: [...c.accountIds] }
      return { kind: 'amount', currency: c.currency, min: amount(c.minMinor), max: amount(c.maxMinor) }
    }),
    categoryId: rule.actions.categoryId ?? '',
    counterpartyId: rule.actions.counterpartyId ?? null,
  }
}

/** undefined for an empty field, null for text that is not an amount. */
function minorOf(text: string): number | undefined | null {
  if (text.trim() === '') return undefined
  const value = parseAmountInput(text)
  return value === null ? null : toMinor(value)
}

/** The request body of the draft, or null while it is not complete (the server checks everything again). */
export function draftToInput(d: RuleDraft): RuleInput | null {
  const name = d.name.trim()
  if (name === '' || d.conditions.length === 0) return null
  if (d.categoryId === '' && d.counterpartyId === null) return null
  const conditions: RuleConditionInput[] = []
  for (const c of d.conditions) {
    if (c.kind === 'text') {
      const values = splitValues(c.values)
      if (values.length === 0 || values.length > MAX_VALUES) return null
      conditions.push({ kind: 'text', op: c.op, values })
    } else if (c.kind === 'account') {
      if (c.accountIds.length === 0) return null
      conditions.push({ kind: 'account', accountIds: [...c.accountIds] })
    } else {
      const minMinor = minorOf(c.min)
      const maxMinor = minorOf(c.max)
      if (minMinor === null || maxMinor === null || (minMinor === undefined && maxMinor === undefined)) return null
      conditions.push({
        kind: 'amount',
        ...(c.currency === '' ? {} : { currency: c.currency }),
        ...(minMinor === undefined ? {} : { minMinor }),
        ...(maxMinor === undefined ? {} : { maxMinor }),
      })
    }
  }
  return {
    name,
    type: d.type,
    active: d.active,
    conditions,
    actions: {
      ...(d.categoryId === '' ? {} : { categoryId: d.categoryId }),
      ...(d.counterpartyId === null ? {} : { counterpartyId: d.counterpartyId }),
    },
  }
}
