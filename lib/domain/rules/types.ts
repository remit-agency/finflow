import type { AutoRuleRef, TxType } from '@/lib/domain/ledger/types'

/** Rules one company may have (a technical limit; plan limits arrive in S17). */
export const MAX_RULES = 50
export const RULE_NAME_MAX = 100
export const MAX_CONDITIONS = 10
export const MAX_VALUES = 20
export const VALUE_MAX = 80
export const MAX_RULE_ACCOUNTS = 20

/** A transfer never gets a rule. */
export const RULE_TYPES = ['income', 'expense'] as const
export type RuleType = (typeof RULE_TYPES)[number]

/** `contains`: any of the words is in one of the texts; `notContains`: none is; `equals`: one whole text is one word. */
export const TEXT_OPS = ['contains', 'notContains', 'equals'] as const
export type TextOp = (typeof TEXT_OPS)[number]

export interface TextCondition {
  kind: 'text'
  op: TextOp
  /** As typed (trimmed); compared after `normalizeRuleText`. */
  values: string[]
}

export interface AccountCondition {
  kind: 'account'
  accountIds: string[]
}

/** Holds for an operation in exactly this currency whose amount (minor units, positive) is within the inclusive bounds. */
export interface AmountCondition {
  kind: 'amount'
  currency: string
  minMinor?: number
  maxMinor?: number
}

export type RuleCondition = TextCondition | AccountCondition | AmountCondition

export interface RuleActions {
  categoryId?: string
  counterpartyId?: string
}

export interface Rule {
  id: string
  name: string
  type: RuleType
  active: boolean
  /** Smaller comes first. */
  order: number
  conditions: RuleCondition[]
  actions: RuleActions
  /** Creation time in ms; breaks a tie of `order`. 0 when unknown. */
  createdAtMs: number
}

/** One operation as the rules see it. */
export interface RuleOperation {
  type: TxType
  accountId: string
  /** The currency of the operation (always its account's). */
  currency: string
  /** Positive, minor units. */
  amountMinor: number
  /** The bank's payment details (`bank.remittance`). */
  remittance?: string
  /** The bank's name for the other party (`bank.counterpartyName`). */
  bankName?: string
  /** The comment. */
  description?: string
  categoryId?: string
  counterpartyId?: string
}

/** What the rules give one operation: only empty fields, and only the rules that really filled one. */
export interface RuleOutcome {
  categoryId?: string
  counterpartyId?: string
  applied: AutoRuleRef[]
}

/** An action that cannot work: the category was deleted or has the other type, the counterparty is gone or archived. */
export type UnusableAction = 'category' | 'counterparty'

/** What the rules' actions point at, as read from Firestore. */
export interface ActionTargets {
  /** Existing categories by id, with their type. */
  categories: ReadonlyMap<string, RuleType>
  /** Existing counterparties by id. */
  counterparties: ReadonlyMap<string, { archived: boolean }>
}

/** A rule as `GET /rules` lists it. */
export type ListedRule = Rule & { unusable: UnusableAction[] }

/** One step of «Застосувати до наявних» in `check` mode (nothing is written). */
export interface CheckStepResult {
  scanned: number
  matchOps: number
  categories: number
  counterparties: number
  done: boolean
  cursor: string | null
}

/** One step of «Застосувати до наявних» in `apply` mode. */
export interface ApplyStepResult {
  scanned: number
  changed: number
  failed: number
  done: boolean
  cursor: string | null
}

/** «Перевірити» in the editor: how many operations without a category or counterparty the draft rule would fill. */
export interface PreviewResult {
  matched: number
  scanned: number
  capped: boolean
}
