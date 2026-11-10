import { isDay } from '@/lib/domain/ledger/days'
import { fromMinor, toMinor } from '@/lib/domain/ledger/money'
import { parseAmountInput } from '@/lib/utils/amount-input'
import { seriesToRaw } from './input'
import { PRESET_DEFAULTS } from './presets'
import { MAX_INTERVAL, SERIES_NAME_MAX, type Frequency, type Preset, type Series, type SeriesKind, type WeekendRule } from './types'

/** What the series editor holds (S11): text as typed; numbers parse on save. */
export interface EditorState {
  name: string
  kind: SeriesKind
  accountId: string
  amount: string
  estimated: boolean
  categoryId: string
  counterpartyId: string
  tagIds: string[]
  description: string
  frequency: Frequency
  interval: string
  dayOfMonth: string
  weekday: string
  startDate: string
  endDate: string
  weekendRule: WeekendRule
  preset: Preset | null
}

export type EditorField = 'name' | 'accountId' | 'amount' | 'dayOfMonth' | 'interval' | 'startDate' | 'endDate'
export type EditorErrors = Partial<Record<EditorField, true>>

export interface InitialOptions {
  series?: Series
  preset?: Preset
  /** The preset's proper name (ZUS, PIT-4, VAT-7): the editor's first name. */
  presetName?: string
  today: string
  defaultAccountId: string
  /** The amount as the person types it in their language. */
  formatAmount: (amount: number) => string
}

/** The editor of a series as stored, of a preset (its day, an estimate, the next business day, its S06 counterparty), or a new one (monthly on today). */
export function initialEditorState(o: InitialOptions): EditorState {
  const s = o.series
  if (s !== undefined) {
    return {
      name: s.name, kind: s.kind, accountId: s.accountId, amount: o.formatAmount(fromMinor(s.amountMinor)), estimated: s.estimated,
      categoryId: s.categoryId ?? '', counterpartyId: s.counterpartyId ?? '', tagIds: [...s.tags], description: s.description ?? '',
      frequency: s.frequency, interval: String(s.interval), dayOfMonth: s.dayOfMonth === null ? '' : String(s.dayOfMonth),
      weekday: s.weekday === null ? '1' : String(s.weekday), startDate: s.startDate, endDate: s.endDate ?? '', weekendRule: s.weekendRule,
      preset: s.preset ?? null,
    }
  }
  const preset = o.preset ?? null
  return {
    name: preset !== null ? (o.presetName ?? '') : '',
    kind: 'expense',
    accountId: o.defaultAccountId,
    amount: '',
    estimated: preset !== null,
    categoryId: '',
    // A preset names no counterparty: the server takes the company's record of its name, else the S06 record (I1).
    counterpartyId: '',
    tagIds: [],
    description: '',
    frequency: 'monthly',
    interval: '2',
    dayOfMonth: preset !== null ? String(PRESET_DEFAULTS[preset].dayOfMonth) : String(Number(o.today.slice(8, 10))),
    weekday: '1',
    startDate: o.today,
    endDate: '',
    weekendRule: preset !== null ? 'next' : 'none',
    preset,
  }
}

const whole = (text: string, min: number, max: number): boolean => /^\d+$/.test(text) && Number(text) >= min && Number(text) <= max
const cleanName = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The fields the server would refuse, checked before the request (the server checks again). */
export function validateEditor(s: EditorState): EditorErrors {
  const e: EditorErrors = {}
  const name = cleanName(s.name)
  if (name.length < 1 || name.length > SERIES_NAME_MAX) e.name = true
  if (s.accountId === '') e.accountId = true
  const amount = parseAmountInput(s.amount)
  if (amount === null || amount <= 0) e.amount = true
  if (s.frequency !== 'weekly' && !whole(s.dayOfMonth, 1, 31)) e.dayOfMonth = true
  if (s.frequency === 'everyNMonths' && !whole(s.interval, 1, MAX_INTERVAL)) e.interval = true
  if (!isDay(s.startDate)) e.startDate = true
  if (s.endDate !== '' && (!isDay(s.endDate) || s.endDate < s.startDate)) e.endDate = true
  return e
}

/** The create body of a valid editor (`validateEditor` gave no errors): what `parseSeriesInput` reads. */
export function editorToBody(s: EditorState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: cleanName(s.name),
    kind: s.kind,
    accountId: s.accountId,
    amountMinor: toMinor(parseAmountInput(s.amount) ?? 0),
    estimated: s.estimated,
    frequency: s.frequency,
    startDate: s.startDate,
    weekendRule: s.weekendRule,
    tags: [...s.tagIds],
  }
  if (s.frequency === 'weekly') body.weekday = Number(s.weekday)
  else body.dayOfMonth = Number(s.dayOfMonth)
  if (s.frequency === 'everyNMonths') body.interval = Number(s.interval)
  if (s.endDate !== '') body.endDate = s.endDate
  if (s.categoryId !== '') body.categoryId = s.categoryId
  if (s.counterpartyId !== '') body.counterpartyId = s.counterpartyId
  const description = s.description.trim()
  if (description !== '') body.description = description
  if (s.preset !== null) body.preset = s.preset
  return body
}

/** The PATCH of an edit: only the fields that differ from the stored series; a field the edit no longer has is null. */
export function editorToPatch(prior: Series, s: EditorState): Record<string, unknown> {
  const next = editorToBody(s)
  const old = seriesToRaw(prior)
  for (const fixed of ['kind', 'preset']) {
    delete next[fixed]
    delete old[fixed]
  }
  const patch: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue
    patch[key] = key in next ? next[key] : null
  }
  return patch
}
