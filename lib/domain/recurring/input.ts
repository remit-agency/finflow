import { addDays, isDay } from '@/lib/domain/ledger/days'
import { MAX_FUTURE_DAYS } from '@/lib/domain/ledger/build'
import { isId } from '@/lib/domain/ledger/guards'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import { MAX_MINOR, isMinor } from '@/lib/domain/ledger/money'
import { bankKeyOf } from '@/lib/domain/ledger/transfer'
import { tagIdsOf } from '@/lib/domain/tags/assign'
import { MAX_TX_TAGS } from '@/lib/domain/tags/types'
import { parseVersion } from '@/lib/domain/transfers/version'
import { RecurringError } from './errors'
import { parsePlanId } from './plan'
import { PRESET_DEFAULTS } from './presets'
import {
  DEFAULT_UPCOMING_PERIOD,
  FREQUENCIES,
  MAX_INTERVAL,
  MAX_MATCH_ITEMS,
  PRESETS,
  SERIES_DESCRIPTION_MAX,
  SERIES_KINDS,
  SERIES_NAME_MAX,
  SERIES_STATUSES,
  WEEKEND_RULES,
  type Frequency,
  type FutureMode,
  UPCOMING_PERIODS,
  type MatchRequest,
  type Preset,
  type Series,
  type SeriesKind,
  type SeriesStatus,
  type UpcomingPeriod,
  type WeekendRule,
} from './types'

function bad(field: string): never {
  throw new RecurringError('invalid_input', field)
}

function asRecord(v: unknown, field = 'body'): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field)
  return v as Record<string, unknown>
}

function onlyKeys(r: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(r)) if (!allowed.includes(k)) bad(k)
}

/** A validated create body (defaults filled). */
export interface SeriesInput {
  name: string
  kind: SeriesKind
  accountId: string
  categoryId?: string
  counterpartyId?: string
  tags: string[]
  description?: string
  amountMinor: number
  estimated: boolean
  preset?: Preset
  frequency: Frequency
  interval: number
  dayOfMonth: number | null
  weekday: number | null
  startDate: string
  endDate?: string
  weekendRule: WeekendRule
}

const CREATE_KEYS = [
  'name', 'kind', 'accountId', 'categoryId', 'counterpartyId', 'tags', 'description', 'amountMinor', 'estimated', 'preset',
  'frequency', 'interval', 'dayOfMonth', 'weekday', 'startDate', 'endDate', 'weekendRule',
] as const
/** `kind` and `preset` are fixed at creation. */
const PATCHABLE: readonly string[] = CREATE_KEYS.filter((k) => k !== 'kind' && k !== 'preset')
const NULLABLE = new Set(['categoryId', 'counterpartyId', 'description', 'endDate', 'interval', 'dayOfMonth', 'weekday'])

/** The display name: whitespace collapsed and trimmed, 1-80 characters. */
export function cleanSeriesName(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.replace(/\s+/g, ' ').trim()
  if (text.length < 1 || text.length > SERIES_NAME_MAX) bad('name')
  return text
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) bad(field)
  return v
}

/** A field the frequency does not use: absent or null. */
function none(v: unknown, field: string): null {
  if (v !== undefined && v !== null) bad(field)
  return null
}

function oneOf<T extends string>(v: unknown, values: readonly T[], field: string): T {
  if (!(values as readonly unknown[]).includes(v)) bad(field)
  return v as T
}

function day(v: unknown, field: string): string {
  if (!isDay(v) || v < MIN_DAY) bad(field)
  return v
}

export function parseSeriesInput(body: unknown): SeriesInput {
  const r = asRecord(body)
  onlyKeys(r, CREATE_KEYS)
  const preset = r.preset === undefined ? undefined : oneOf(r.preset, PRESETS, 'preset')
  const kind = oneOf(r.kind, SERIES_KINDS, 'kind')
  if (preset !== undefined && kind !== 'expense') bad('kind')
  if (!isId(r.accountId)) bad('accountId')
  const frequency = oneOf(r.frequency, FREQUENCIES, 'frequency')
  if (!isMinor(r.amountMinor) || r.amountMinor <= 0 || r.amountMinor > MAX_MINOR) bad('amountMinor')
  const tags = r.tags === undefined ? [] : tagIdsOf(r.tags, MAX_TX_TAGS)
  if (tags === null) bad('tags')
  if (r.estimated !== undefined && typeof r.estimated !== 'boolean') bad('estimated')
  const weekly = frequency === 'weekly'
  let interval = 1
  if (frequency === 'everyNMonths') interval = int(r.interval, 'interval', 1, MAX_INTERVAL)
  else if (r.interval !== undefined && r.interval !== null && r.interval !== 1) bad('interval')
  const presetDay = preset === undefined ? undefined : PRESET_DEFAULTS[preset].dayOfMonth
  const startDate = day(r.startDate, 'startDate')

  const out: SeriesInput = {
    name: cleanSeriesName(r.name),
    kind,
    accountId: r.accountId,
    tags,
    amountMinor: r.amountMinor,
    estimated: typeof r.estimated === 'boolean' ? r.estimated : preset !== undefined,
    frequency,
    interval,
    dayOfMonth: weekly ? none(r.dayOfMonth, 'dayOfMonth') : int(r.dayOfMonth ?? presetDay, 'dayOfMonth', 1, 31),
    weekday: weekly ? int(r.weekday, 'weekday', 1, 7) : none(r.weekday, 'weekday'),
    startDate,
    weekendRule: r.weekendRule === undefined ? (preset !== undefined ? 'next' : 'none') : oneOf(r.weekendRule, WEEKEND_RULES, 'weekendRule'),
  }
  if (preset !== undefined) out.preset = preset
  if (r.endDate !== undefined && r.endDate !== null) {
    const endDate = day(r.endDate, 'endDate')
    if (endDate < startDate) bad('endDate')
    out.endDate = endDate
  }
  for (const key of ['categoryId', 'counterpartyId'] as const) {
    const value = r[key]
    if (value === undefined || value === null) continue
    if (!isId(value)) bad(key)
    out[key] = value
  }
  if (r.description !== undefined && r.description !== null) {
    if (typeof r.description !== 'string') bad('description')
    const text = r.description.trim()
    if (text.length > SERIES_DESCRIPTION_MAX) bad('description')
    if (text.length > 0) out.description = text
  }
  return out
}

/** A start or an end further than the ledger plans ahead (`MAX_FUTURE_DAYS`) is refused (the server knows today). */
export function assertSeriesHorizon(s: Pick<SeriesInput, 'startDate' | 'endDate'>, today: string): void {
  const horizon = addDays(today, MAX_FUTURE_DAYS)
  if (s.startDate > horizon) bad('startDate')
  if (s.endDate !== undefined && s.endDate > horizon) bad('endDate')
}

/** A new active series from a validated body; the fill state comes with the first fill. */
export function seriesFromInput(id: string, input: SeriesInput, currency: string): Series {
  return { id, ...input, currency, status: 'active' }
}

/** The stored series as a create body: what a PATCH is merged onto (only the fields its frequency uses). */
export function seriesToRaw(s: Series): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    name: s.name, kind: s.kind, accountId: s.accountId, tags: [...s.tags], amountMinor: s.amountMinor, estimated: s.estimated,
    frequency: s.frequency, startDate: s.startDate, weekendRule: s.weekendRule,
  }
  if (s.frequency === 'everyNMonths') raw.interval = s.interval
  if (s.frequency === 'weekly') raw.weekday = s.weekday
  else raw.dayOfMonth = s.dayOfMonth
  if (s.endDate !== undefined) raw.endDate = s.endDate
  if (s.categoryId !== undefined) raw.categoryId = s.categoryId
  if (s.counterpartyId !== undefined) raw.counterpartyId = s.counterpartyId
  if (s.description !== undefined) raw.description = s.description
  if (s.preset !== undefined) raw.preset = s.preset
  return raw
}

/** A validated PATCH: the changed fields (null clears an optional one), the new status, and whether a pause removes the future plans. */
export interface SeriesPatch {
  changes: Record<string, unknown>
  status?: SeriesStatus
  removeFuture: boolean
}

export function parseSeriesPatch(body: unknown): SeriesPatch {
  const r = asRecord(body)
  onlyKeys(r, [...PATCHABLE, 'status', 'removeFuture'])
  const changes: Record<string, unknown> = {}
  for (const key of PATCHABLE) {
    if (!(key in r)) continue
    if (r[key] === null && !NULLABLE.has(key)) bad(key)
    changes[key] = r[key]
  }
  const out: SeriesPatch = { changes, removeFuture: false }
  if (r.status !== undefined) out.status = oneOf(r.status, SERIES_STATUSES, 'status')
  if (r.removeFuture !== undefined) {
    if (typeof r.removeFuture !== 'boolean') bad('removeFuture')
    out.removeFuture = r.removeFuture
  }
  if (out.removeFuture && out.status !== 'paused') bad('removeFuture')
  if (Object.keys(changes).length === 0 && out.status === undefined) bad('body')
  return out
}

/**
 * The series after a PATCH: the stored series as a body, the changes merged (null deletes), the whole revalidated by
 * `parseSeriesInput` (one validation for create and change). A new frequency drops the fields only the old one used, unless
 * the patch gives them. The fill state stays: the writer decides it.
 */
export function applySeriesPatch(s: Series, patch: SeriesPatch): Series {
  const raw = seriesToRaw(s)
  const { changes } = patch
  if ('frequency' in changes) {
    if (changes.frequency === 'weekly') {
      if (!('dayOfMonth' in changes)) delete raw.dayOfMonth
    } else if (!('weekday' in changes)) delete raw.weekday
    if (changes.frequency !== 'everyNMonths' && !('interval' in changes)) delete raw.interval
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete raw[key]
    else raw[key] = value
  }
  const next: Series = { ...seriesFromInput(s.id, parseSeriesInput(raw), s.currency), status: patch.status ?? s.status }
  if (s.generatedThrough !== undefined) next.generatedThrough = s.generatedThrough
  if (s.dueOn !== undefined) next.dueOn = s.dueOn
  return next
}

/** `DELETE /recurring/{id}?future=delete|keep`: nothing else in the query; `delete` when absent. */
export function parseDeleteQuery(query: URLSearchParams): FutureMode {
  for (const key of query.keys()) if (key !== 'future') bad(key)
  const values = query.getAll('future')
  if (values.length === 0) return 'delete'
  const value = values[0]
  if (values.length !== 1 || (value !== 'delete' && value !== 'keep')) bad('future')
  return value
}

/** `GET /recurring/upcoming?period=month|half|all`; month when absent. */
export function parseUpcomingQuery(query: URLSearchParams): UpcomingPeriod {
  for (const key of query.keys()) if (key !== 'period') bad(key)
  const values = query.getAll('period')
  if (values.length === 0) return DEFAULT_UPCOMING_PERIOD
  const value = values[0]
  const period = UPCOMING_PERIODS.find((p) => p === value)
  if (values.length !== 1 || period === undefined) bad('period')
  return period
}

/** `POST /recurring/{id}/skip { occurrence }`. */
export function parseSkipBody(body: unknown): { occurrence: string } {
  const r = asRecord(body)
  onlyKeys(r, ['occurrence'])
  if (!isDay(r.occurrence)) bad('occurrence')
  return { occurrence: r.occurrence }
}

/** `POST /recurring/matches`: `{ confirm: [{ planId, bankId, versions }] }` or `{ undo: [planId] }`, 1-50 each, none twice. */
export function parseMatchRequest(body: unknown): MatchRequest {
  const r = asRecord(body)
  const keys = Object.keys(r)
  if (keys.length !== 1) bad('body')
  if (keys[0] === 'confirm') {
    const list = r.confirm
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MATCH_ITEMS) bad('confirm')
    const items = list.map((item: unknown) => {
      const o = asRecord(item, 'confirm')
      onlyKeys(o, ['planId', 'bankId', 'versions'])
      if (typeof o.planId !== 'string' || parsePlanId(o.planId) === null) bad('planId')
      if (!isId(o.bankId) || bankKeyOf(o.bankId) === null) bad('bankId')
      const v = o.versions
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => parseVersion(x) !== null)) bad('versions')
      return { planId: o.planId, bankId: o.bankId, versions: [v[0] as string, v[1] as string] as [string, string] }
    })
    if (new Set(items.map((i) => i.planId)).size !== items.length || new Set(items.map((i) => i.bankId)).size !== items.length) bad('confirm')
    return { kind: 'confirm', items }
  }
  if (keys[0] === 'undo') {
    const list = r.undo
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MATCH_ITEMS) bad('undo')
    const planIds = list.map((id: unknown) => {
      if (typeof id !== 'string' || parsePlanId(id) === null) bad('undo')
      return id
    })
    if (new Set(planIds).size !== planIds.length) bad('undo')
    return { kind: 'undo', planIds }
  }
  return bad(keys[0])
}
