import { isDay } from '@/lib/domain/ledger/days'
import { isId } from '@/lib/domain/ledger/guards'
import { RecurringError } from './errors'
import { parseSeriesInput, seriesFromInput } from './input'
import { planId } from './plan'
import {
  DONE_REASONS,
  DONE_SCHEMA_VERSION,
  RECURRING_SCHEMA_VERSION,
  SERIES_STATUSES,
  type Carried,
  type DoneMark,
  type DoneMarkFields,
  type DoneReason,
  type Series,
  type SeriesStatus,
} from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The stored fields of a series (no id; the writer adds orgId, createdAt, createdBy, updatedAt, updatedBy, version). */
export function seriesToDoc(s: Series): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: RECURRING_SCHEMA_VERSION,
    name: s.name,
    kind: s.kind,
    accountId: s.accountId,
    tags: s.tags,
    amountMinor: s.amountMinor,
    currency: s.currency,
    estimated: s.estimated,
    frequency: s.frequency,
    interval: s.interval,
    dayOfMonth: s.dayOfMonth,
    weekday: s.weekday,
    startDate: s.startDate,
    weekendRule: s.weekendRule,
    status: s.status,
  }
  for (const key of ['categoryId', 'counterpartyId', 'description', 'endDate', 'preset', 'generatedThrough', 'dueOn'] as const) {
    if (s[key] !== undefined) doc[key] = s[key]
  }
  return doc
}

const BODY_KEYS = [
  'name', 'kind', 'accountId', 'categoryId', 'counterpartyId', 'tags', 'description', 'amountMinor', 'estimated', 'preset',
  'frequency', 'interval', 'dayOfMonth', 'weekday', 'startDate', 'endDate', 'weekendRule',
] as const

/**
 * A stored series, validated by the same rule as a create body (`parseSeriesInput`), or null when it is not a schema 1
 * series. The generator relies on every field it reads, so a malformed series is skipped, never half-filled.
 */
export function parseSeries(id: string, data: unknown): Series | null {
  if (!isRecord(data) || data.schemaVersion !== RECURRING_SCHEMA_VERSION) return null
  if (typeof data.currency !== 'string' || !(SERIES_STATUSES as readonly unknown[]).includes(data.status)) return null
  for (const key of ['generatedThrough', 'dueOn'] as const) if (data[key] !== undefined && !isDay(data[key])) return null
  const raw: Record<string, unknown> = {}
  for (const key of BODY_KEYS) if (data[key] !== undefined && data[key] !== null) raw[key] = data[key]
  try {
    const series: Series = { ...seriesFromInput(id, parseSeriesInput(raw), data.currency), status: data.status as SeriesStatus }
    if (typeof data.generatedThrough === 'string') series.generatedThrough = data.generatedThrough
    if (typeof data.dueOn === 'string') series.dueOn = data.dueOn
    return series
  } catch (e) {
    if (e instanceof RecurringError) return null
    throw e
  }
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? [...v] : null
}

function carriedToDoc(c: Carried): Record<string, unknown> {
  const doc: Record<string, unknown> = {}
  if (c.categoryId !== undefined) doc.categoryId = c.categoryId
  if (c.counterpartyId !== undefined) doc.counterpartyId = c.counterpartyId
  if (c.description !== undefined) doc.description = c.description
  if (c.tags !== undefined) doc.tags = [...c.tags]
  return doc
}

function parseCarried(v: unknown): Carried | undefined {
  if (!isRecord(v)) return undefined
  const c: Carried = {}
  for (const key of ['categoryId', 'counterpartyId', 'description'] as const) if (typeof v[key] === 'string') c[key] = v[key] as string
  const tags = stringList(v.tags)
  if (tags !== null) c.tags = tags
  return c
}

/** The stored fields of a mark (no id; the writer adds `at`, `by` and, for a match, the plan's `planCreatedAt`/`planCreatedBy`). */
export function doneToDoc(m: DoneMarkFields): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: DONE_SCHEMA_VERSION,
    seriesId: m.seriesId,
    occurrence: m.occurrence,
    reason: m.reason,
    estimated: m.estimated,
    manual: m.manual,
  }
  if (m.txId !== undefined) doc.txId = m.txId
  if (m.plan !== undefined) doc.plan = m.plan
  if (m.carried !== undefined) doc.carried = carriedToDoc(m.carried)
  return doc
}

/** A stored mark, or null when it is not one or does not belong under `id` (its plan id). */
export function parseDone(id: string, data: unknown): DoneMark | null {
  if (!isRecord(data) || data.schemaVersion !== DONE_SCHEMA_VERSION) return null
  const { seriesId, occurrence, reason, txId } = data
  if (!isId(seriesId) || !isDay(occurrence) || planId(seriesId, occurrence) !== id) return null
  if (!(DONE_REASONS as readonly unknown[]).includes(reason)) return null
  if (txId !== undefined && !isId(txId)) return null
  const mark: DoneMark = { id, seriesId, occurrence, reason: reason as DoneReason, estimated: data.estimated === true, manual: data.manual === true }
  if (typeof txId === 'string') mark.txId = txId
  if (isRecord(data.plan)) mark.plan = data.plan
  const carried = parseCarried(data.carried)
  if (carried !== undefined) mark.carried = carried
  return mark
}
