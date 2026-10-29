import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import { isId } from '@/lib/domain/ledger/guards'
import { asRecord, bad, onlyKeys } from './guards'
import { DEFAULT_TAG_COLOR, TAG_COLORS, TAG_NAME_MAX, type TagColor } from './types'

/** A validated create request (defaults filled). */
export interface TagInput {
  name: string
  color: TagColor
  excludeFromAnalytics: boolean
}

/** A validated PATCH: only the fields given, at least one. */
export interface TagPatch {
  name?: string
  color?: TagColor
  excludeFromAnalytics?: boolean
  archived?: boolean
}

/** The display name: trimmed, inner whitespace collapsed, 1-50 characters, with a letter or a digit (it has no key otherwise). */
export function cleanTagName(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.replace(/\s+/g, ' ').trim()
  if (text.length < 1 || text.length > TAG_NAME_MAX || nameKeyText(text) === '') bad('name')
  return text
}

function color(v: unknown): TagColor {
  if (!(TAG_COLORS as readonly unknown[]).includes(v)) bad('color')
  return v as TagColor
}

function flag(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') bad(field)
  return v
}

export function parseTagInput(body: unknown): TagInput {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'color', 'excludeFromAnalytics'])
  return {
    name: cleanTagName(r.name),
    color: r.color === undefined ? DEFAULT_TAG_COLOR : color(r.color),
    excludeFromAnalytics: r.excludeFromAnalytics === undefined ? false : flag(r.excludeFromAnalytics, 'excludeFromAnalytics'),
  }
}

export function parseTagPatch(body: unknown): TagPatch {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'color', 'excludeFromAnalytics', 'archived'])
  const out: TagPatch = {}
  if (r.name !== undefined) out.name = cleanTagName(r.name)
  if (r.color !== undefined) out.color = color(r.color)
  if (r.excludeFromAnalytics !== undefined) out.excludeFromAnalytics = flag(r.excludeFromAnalytics, 'excludeFromAnalytics')
  if (r.archived !== undefined) out.archived = flag(r.archived, 'archived')
  if (Object.keys(out).length === 0) bad('body')
  return out
}

/** `POST /tags/{id}/recalculate`: the id of the last operation the previous step read (absent on the first one). */
export function parseRecalcRequest(body: unknown): { cursor: string | null } {
  const r = asRecord(body)
  onlyKeys(r, ['cursor'])
  if (r.cursor === undefined) return { cursor: null }
  if (!isId(r.cursor)) bad('cursor')
  return { cursor: r.cursor }
}
