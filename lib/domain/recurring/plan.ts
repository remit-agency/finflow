import { addDays, isDay } from '@/lib/domain/ledger/days'
import { isId } from '@/lib/domain/ledger/guards'
import { PLAN_CLIENT_ID_PREFIX, type TransactionInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { occurrencesBetween, paymentDayOf, periodOf, windowEnd } from './schedule'
import { MAX_FILL_PER_SERIES, type Series } from './types'

/** The deterministic id of an occurrence's operation: creating it again writes the same document. */
export function planId(seriesId: string, occurrence: string): string {
  return `${PLAN_CLIENT_ID_PREFIX}${seriesId}_${occurrence}`
}

const PLAN_ID = /^pl_(.+)_(\d{4}-\d{2}-\d{2})$/
/** Client ids are at most 64 characters (lib/domain/ledger/input.ts): a plan id must fit the create route. */
const MAX_PLAN_ID = 64

/** The series and the occurrence of a plan id, or null when it is not one. */
export function parsePlanId(id: string): { seriesId: string; occurrence: string } | null {
  const m = PLAN_ID.exec(id)
  if (m === null || id.length > MAX_PLAN_ID || !isId(m[1]) || !isDay(m[2])) return null
  return { seriesId: m[1], occurrence: m[2] }
}

function endedBy(s: Series, through: string): boolean {
  return s.endDate !== undefined && s.endDate <= through
}

/** What one fill of a series creates (`occurrences`) and the fill state it leaves on the series. */
export interface FillPlan {
  occurrences: string[]
  generatedThrough?: string
  dueOn?: string
}

/**
 * One fill of an active series on `today` (the daily generator and the create): the occurrences from the day after the last
 * fill (from today on the first fill, never before `startDate`) to the window end, at most `max`. A fill that reached the
 * window end is due again tomorrow, or never once `endDate` is behind it; a capped one stays due today and continues after
 * its last occurrence. A paused series creates nothing and is not due. Whether an occurrence already has an operation or a
 * mark is the server's check; this plan never returns an occurrence twice across fills.
 */
export function fillPlan(s: Series, today: string, max: number = MAX_FILL_PER_SERIES): FillPlan {
  if (s.status !== 'active') return { occurrences: [], generatedThrough: s.generatedThrough }
  const from = s.generatedThrough === undefined ? today : addDays(s.generatedThrough, 1)
  const end = windowEnd(today)
  const all = occurrencesBetween(s, from, end)
  if (all.length > max) {
    const occurrences = all.slice(0, max)
    return { occurrences, generatedThrough: occurrences[occurrences.length - 1], dueOn: today }
  }
  const generatedThrough = s.generatedThrough !== undefined && s.generatedThrough > end ? s.generatedThrough : end
  return { occurrences: all, generatedThrough, dueOn: endedBy(s, generatedThrough) ? undefined : addDays(today, 1) }
}

/**
 * The occurrences a changed (or resumed) series plans on `today`: its schedule from today to the window end, except those
 * whose period (`periodOf` of the new schedule) is already taken by a mark or an operation the change does not rewrite.
 */
export function rewriteOccurrences(s: Series, today: string, taken: ReadonlySet<string>): string[] {
  return occurrencesBetween(s, today, windowEnd(today)).filter((o) => !taken.has(periodOf(s, o)))
}

/** The fill state after a change of an active series: filled to the window end, due tomorrow until it ends. */
export function rewriteState(s: Series, today: string): Pick<FillPlan, 'generatedThrough' | 'dueOn'> {
  const end = windowEnd(today)
  return { generatedThrough: end, dueOn: s.status === 'active' && !endedBy(s, end) ? addDays(today, 1) : undefined }
}

/** The references of a series its plans can carry now (a deleted category, a missing or archived counterparty or tag are left out). */
export interface UsableRefs {
  categoryId?: string
  counterpartyId?: string
  tags: string[]
}

/**
 * The create input of one occurrence: a planned operation on its payment day (`weekendRule`), the accrual on that day,
 * never marked «Повторювана» (the series link is `seriesId`, see `seriesFieldsOf`), under its plan id.
 */
export function planInputOf(s: Series, occurrence: string, usable: UsableRefs): TransactionInput {
  const paymentDate = paymentDayOf(occurrence, s.weekendRule)
  const input: TransactionInput = {
    clientId: planId(s.id, occurrence),
    type: s.kind,
    status: 'planned',
    accountId: s.accountId,
    amountMinor: s.amountMinor,
    paymentDate,
    accrual: { mode: 'date', date: paymentDate },
    isRecurring: false,
    tags: [...usable.tags],
    fileUrls: [],
  }
  if (usable.categoryId !== undefined) input.categoryId = usable.categoryId
  if (usable.counterpartyId !== undefined) input.counterpartyId = usable.counterpartyId
  if (s.description !== undefined) input.description = s.description
  return input
}

/** The series fields of an occurrence's operation (only the server writes them). */
export function seriesFieldsOf(s: Series, occurrence: string): Pick<LedgerTransaction, 'seriesId' | 'occurrence' | 'estimated'> {
  return s.estimated ? { seriesId: s.id, occurrence, estimated: true } : { seriesId: s.id, occurrence }
}
