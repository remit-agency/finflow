import type { TagInput, TagPatch } from '@/lib/domain/tags/input'
import type { RecalcStepResult, Tag, TagImpact, UpdateTagResult } from '@/lib/domain/tags/types'
import { notifyLedgerChanged } from './ledger-events'
import { apiCall, LedgerApiError, readApiError } from './ledger-client'

/** A recalculation step reads 100 operations: this only stops a runaway loop (100 000 operations). */
const MAX_STEPS = 1000

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/tags`

/** A create body: the server fills the colour (slate) and the flag (off) when they are left out. */
export type TagDraft = Pick<TagInput, 'name'> & Partial<Omit<TagInput, 'name'>>

export async function createTag(orgId: string, draft: TagDraft): Promise<Tag> {
  return ((await apiCall('POST', base(orgId), draft)) as { tag: Tag }).tag
}

/** `recalc: true` means the operations of the tag must now be recalculated (`recalculateTag`). */
export async function updateTag(orgId: string, tagId: string, patch: TagPatch): Promise<UpdateTagResult> {
  return (await apiCall('PATCH', `${base(orgId)}/${encodeURIComponent(tagId)}`, patch)) as UpdateTagResult
}

/** How many operations carry the tag: what a change of its flag recalculates. */
export async function tagImpact(orgId: string, tagId: string): Promise<number> {
  return ((await apiCall('GET', `${base(orgId)}/${encodeURIComponent(tagId)}/impact`)) as TagImpact).operations
}

export interface RecalcTotals {
  scanned: number
  changed: number
  /** The step cap ended the run before done. */
  stoppedEarly: boolean
}

/** A step failed after earlier steps: the counts so far stay with the error (`cause` is the step's error). */
export class RecalcRunError extends Error {
  constructor(
    public readonly totals: RecalcTotals,
    public readonly cause: unknown,
  ) {
    super('tag recalculation failed')
    this.name = 'RecalcRunError'
  }
}

/** Runs the recalculation of a tag's operations to the end, step by step; the journal reloads once when something changed. */
export async function recalculateTag(
  orgId: string,
  tagId: string,
  opts: { signal?: AbortSignal; onProgress?: (totals: RecalcTotals) => void } = {},
): Promise<RecalcTotals> {
  const totals: RecalcTotals = { scanned: 0, changed: 0, stoppedEarly: true }
  let cursor: string | null = null
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      let answer: RecalcStepResult
      try {
        const res = await fetch(`${base(orgId)}/${encodeURIComponent(tagId)}/recalculate`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cursor === null ? {} : { cursor }),
          signal: opts.signal,
        })
        if (!res.ok) throw await readApiError(res)
        answer = (await res.json()) as RecalcStepResult
      } catch (err) {
        throw new RecalcRunError({ ...totals }, err)
      }
      totals.scanned += answer.scanned
      totals.changed += answer.changed
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

/** The tag behind a `duplicate` answer (another tag has the name), or null for any other error. */
export function duplicateTagOf(e: unknown): { existingId: string | undefined } | null {
  if (!(e instanceof LedgerApiError) || e.code !== 'duplicate') return null
  const existingId = e.details?.existingId
  return { existingId: typeof existingId === 'string' ? existingId : undefined }
}
