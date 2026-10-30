import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { mergeTags } from '@/lib/domain/tags/assign'
import { MAX_TX_TAGS } from '@/lib/domain/tags/types'
import { normalizeRuleText } from './normalize'
import type { Rule, RuleCondition, RuleOperation, RuleOutcome, TextCondition } from './types'

/** The normalised words of a text condition, computed once per condition object (a step applies 50 rules to 200 operations). */
const WORDS = new WeakMap<TextCondition, string[]>()

function wordsOf(c: TextCondition): string[] {
  let words = WORDS.get(c)
  if (words === undefined) {
    words = c.values.map(normalizeRuleText).filter((w) => w !== '')
    WORDS.set(c, words)
  }
  return words
}

/** The texts the rules look at (the bank's payment details, its name for the other party, the comment), normalised; empty ones left out. */
function textsOf(op: RuleOperation): string[] {
  return [op.remittance, op.bankName, op.description]
    .filter((t): t is string => typeof t === 'string')
    .map(normalizeRuleText)
    .filter((t) => t !== '')
}

function holds(c: RuleCondition, op: RuleOperation, texts: readonly string[]): boolean {
  switch (c.kind) {
    case 'text': {
      const words = wordsOf(c)
      if (c.op === 'equals') return words.some((w) => texts.includes(w))
      // Each text separately: a word never runs across the end of one text and the start of the next.
      const found = words.some((w) => texts.some((t) => t.includes(w)))
      return c.op === 'contains' ? found : !found
    }
    case 'account':
      return c.accountIds.includes(op.accountId)
    case 'amount':
      return (
        op.currency === c.currency &&
        (c.minMinor === undefined || op.amountMinor >= c.minMinor) &&
        (c.maxMinor === undefined || op.amountMinor <= c.maxMinor)
      )
  }
}

function matchesWith(rule: Rule, op: RuleOperation, texts: readonly string[]): boolean {
  return rule.active && rule.type === op.type && rule.conditions.every((c) => holds(c, op, texts))
}

/** True when the rule is active, of the operation's type, and every one of its conditions holds. */
export function ruleMatches(rule: Rule, op: RuleOperation): boolean {
  return matchesWith(rule, op, textsOf(op))
}

/** The order the rules are applied in: `order` ascending, then creation time, then id. A new array. */
export function sortRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort((a, b) => a.order - b.order || a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * What the rules give an operation. Each empty field (category, counterparty) is filled by the first matching rule that
 * has that action; a field that is already set is never touched. Tags (S10t) are added, not chosen: every matching rule
 * adds the tags the operation does not have yet, in rule order, while it has fewer than 10; no rule takes a tag off.
 * `applied` lists only the rules that gave something. Unusable actions must be removed before (`withoutUnusableActions`).
 */
export function applyRules(rules: readonly Rule[], op: RuleOperation): RuleOutcome {
  const out: RuleOutcome = { applied: [] }
  if (op.type === 'transfer') return out
  let needCategory = op.categoryId === undefined
  let needCounterparty = op.counterpartyId === undefined
  const own = op.tagIds ?? []
  let tags: string[] = [...own]
  const nothingLeft = () => !needCategory && !needCounterparty && tags.length >= MAX_TX_TAGS
  if (nothingLeft()) return out
  const texts = textsOf(op)
  for (const rule of sortRules(rules)) {
    if (nothingLeft()) break
    if (!matchesWith(rule, op, texts)) continue
    let filled = false
    if (needCategory && rule.actions.categoryId !== undefined) {
      out.categoryId = rule.actions.categoryId
      needCategory = false
      filled = true
    }
    if (needCounterparty && rule.actions.counterpartyId !== undefined) {
      out.counterpartyId = rule.actions.counterpartyId
      needCounterparty = false
      filled = true
    }
    if (rule.actions.tagIds !== undefined) {
      const merged = mergeTags(tags, rule.actions.tagIds)
      if (merged.length > tags.length) {
        tags = merged
        filled = true
      }
    }
    if (filled) out.applied.push({ id: rule.id, name: rule.name })
  }
  if (tags.length > own.length) out.tagIds = tags
  return out
}

/** A stored operation as the rules see it. */
export function ruleOperationOf(tx: LedgerTransaction): RuleOperation {
  const op: RuleOperation = { type: tx.type, accountId: tx.accountId, currency: tx.currency, amountMinor: tx.amountMinor }
  if (tx.bank?.remittance !== undefined) op.remittance = tx.bank.remittance
  if (tx.bank?.counterpartyName !== undefined) op.bankName = tx.bank.counterpartyName
  if (tx.description !== undefined) op.description = tx.description
  if (tx.categoryId !== undefined) op.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) op.counterpartyId = tx.counterpartyId
  if (tx.tags.length > 0) op.tagIds = tx.tags
  return op
}
