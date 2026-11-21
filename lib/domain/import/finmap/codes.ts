import type { LedgerErrorCode } from '@/lib/domain/ledger/errors'

/**
 * Why the Finmap batch writer refuses one operation: a ledger code (the ledger's own refusal), the batch's duplicate-key rule, or
 * `rate_unavailable` (no NBP rate for the operation's day: permanent, unlike a provider outage, which fails the whole request).
 */
export type BatchRefusalReason = LedgerErrorCode | 'duplicate_key' | 'rate_unavailable'

/**
 * Every refusal code the batch can answer with. `satisfies` makes the list complete: a code added to `BatchRefusalReason` without
 * an entry here is a type error, and the texts test then requires a text in each locale for every entry.
 */
export const BATCH_REFUSAL_CODES = {
  invalid_input: true,
  not_found: true,
  account_not_found: true,
  category_not_found: true,
  counterparty_not_found: true,
  counterparty_archived: true,
  currency_mismatch: true,
  future_actual: true,
  account_has_operations: true,
  account_linked_to_bank: true,
  currency_locked: true,
  ledger_busy: true,
  conflict: true,
  bank_locked: true,
  tag_not_found: true,
  tag_archived: true,
  not_eligible: true,
  series_transfer: true,
  duplicate_key: true,
  rate_unavailable: true,
} as const satisfies Record<BatchRefusalReason, true>

/** The codes a run can stop with that the screen has a text for (the others get the generic text with the code). */
export const STOP_CODES = {
  ledger_busy: true,
  conflict: true,
  network: true,
  aborted: true,
  provider_unavailable: true,
} as const

export type BatchRefusalKey = keyof typeof BATCH_REFUSAL_CODES
export type StopKey = keyof typeof STOP_CODES

/** Whether a code is one the batch writer can refuse with (a boundary value: any string may arrive). */
export const isBatchRefusalCode = (code: string): code is BatchRefusalKey => Object.hasOwn(BATCH_REFUSAL_CODES, code)
export const isStopCode = (code: string): code is StopKey => Object.hasOwn(STOP_CODES, code)

/** The message key (under `import.finmap`) of a refusal code: its own text, or the generic one that carries the code. */
export function batchRefusalTextKey(code: string): `batchRefusal.${BatchRefusalKey | 'unknown'}` {
  return isBatchRefusalCode(code) ? `batchRefusal.${code}` : 'batchRefusal.unknown'
}

/** The message key (under `import.finmap`) of a stop code: its own text, or the generic one that carries the code. */
export function stopTextKey(code: string): `stopCode.${StopKey | 'unknown'}` {
  return isStopCode(code) ? `stopCode.${code}` : 'stopCode.unknown'
}
