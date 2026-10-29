import type { RuleInput, RulePatch } from '@/lib/domain/rules/input'
import type { ApplyStepResult, CheckStepResult, ListedRule, PreviewResult, Rule } from '@/lib/domain/rules/types'
import { notifyLedgerChanged } from './ledger-events'
import { apiCall, readApiError } from './ledger-client'

/** A check step reads 200 operations and an apply step changes at most 25: this only stops a runaway loop. */
const MAX_STEPS = 2000

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/rules`

export async function fetchRules(orgId: string, signal?: AbortSignal): Promise<ListedRule[]> {
  const res = await fetch(base(orgId), { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return ((await res.json()) as { rules: ListedRule[] }).rules
}

export async function createRule(orgId: string, input: RuleInput): Promise<Rule> {
  return ((await apiCall('POST', base(orgId), input)) as { rule: Rule }).rule
}

export async function updateRule(orgId: string, ruleId: string, patch: RulePatch): Promise<Rule> {
  return ((await apiCall('PATCH', `${base(orgId)}/${encodeURIComponent(ruleId)}`, patch)) as { rule: Rule }).rule
}

export async function deleteRule(orgId: string, ruleId: string): Promise<void> {
  await apiCall('DELETE', `${base(orgId)}/${encodeURIComponent(ruleId)}`)
}

/** `ids`: all the company's rules in the new order. */
export async function orderRules(orgId: string, ids: string[]): Promise<void> {
  await apiCall('POST', `${base(orgId)}/order`, { ids })
}

/** «Перевірити»: how many operations without a category or counterparty the draft rule would fill (nothing is saved). */
export async function previewRule(orgId: string, rule: RuleInput, signal?: AbortSignal): Promise<PreviewResult> {
  const res = await fetch(`${base(orgId)}/preview`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rule }),
    signal,
  })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as PreviewResult
}

async function step<T>(orgId: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${base(orgId)}/apply`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

export interface CheckTotals {
  scanned: number
  matchOps: number
  categories: number
  counterparties: number
  /** The step cap ended the count before the last step: the totals are partial. */
  stoppedEarly: boolean
}

/** Counts, step by step, what «Застосувати до наявних» would change. Writes nothing. */
export async function checkExisting(
  orgId: string,
  opts: { signal?: AbortSignal; onProgress?: (totals: CheckTotals) => void } = {},
): Promise<CheckTotals> {
  const totals: CheckTotals = { scanned: 0, matchOps: 0, categories: 0, counterparties: 0, stoppedEarly: true }
  let cursor: string | null = null
  for (let i = 0; i < MAX_STEPS; i++) {
    const answer: CheckStepResult = await step<CheckStepResult>(orgId, cursor === null ? { mode: 'check' } : { mode: 'check', cursor }, opts.signal)
    totals.scanned += answer.scanned
    totals.matchOps += answer.matchOps
    totals.categories += answer.categories
    totals.counterparties += answer.counterparties
    if (answer.done || answer.cursor === null) {
      totals.stoppedEarly = false
      break
    }
    cursor = answer.cursor
    opts.onProgress?.({ ...totals })
  }
  return totals
}

export interface ApplyTotals {
  scanned: number
  changed: number
  failed: number
  /** The step cap ended the run before done: the rest of the operations were not visited. */
  stoppedEarly: boolean
}

/** A step failed after earlier steps: the counts so far stay with the error (`cause` is the step's error). */
export class RulesRunError extends Error {
  constructor(
    public readonly totals: ApplyTotals,
    public readonly cause: unknown,
  ) {
    super('rules run failed')
    this.name = 'RulesRunError'
  }
}

/** Runs «Застосувати до наявних» to the end; the journal reloads once when something changed. */
export async function applyToExisting(
  orgId: string,
  opts: { signal?: AbortSignal; onProgress?: (totals: ApplyTotals) => void } = {},
): Promise<ApplyTotals> {
  const totals: ApplyTotals = { scanned: 0, changed: 0, failed: 0, stoppedEarly: true }
  let cursor: string | null = null
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      let answer: ApplyStepResult
      try {
        answer = await step<ApplyStepResult>(orgId, cursor === null ? { mode: 'apply' } : { mode: 'apply', cursor }, opts.signal)
      } catch (err) {
        throw new RulesRunError({ ...totals }, err)
      }
      totals.scanned += answer.scanned
      totals.changed += answer.changed
      totals.failed += answer.failed
      if (answer.done || answer.cursor === null) {
        totals.stoppedEarly = false
        break
      }
      cursor = answer.cursor
      opts.onProgress?.({ ...totals })
    }
  } finally {
    if (totals.changed > 0) notifyLedgerChanged()
  }
  return totals
}
