/** The palette of tag colours (S10t): keys, never colour values. The UI maps them to the `--color-tag-*` tokens. */
export const TAG_COLORS = ['slate', 'sky', 'emerald', 'amber', 'rose', 'violet'] as const
export type TagColor = (typeof TAG_COLORS)[number]
export const DEFAULT_TAG_COLOR: TagColor = 'slate'

/** Characters of a tag name. */
export const TAG_NAME_MAX = 50
/** Tags one company may have (a technical limit; plan limits arrive in S17). */
export const MAX_TAGS = 100
/** Tags one operation may carry. */
export const MAX_TX_TAGS = 10
/** Tags one rule may add. */
export const MAX_RULE_TAGS = 5
/** Operations one step of `POST /tags/{id}/recalculate` reads. */
export const RECALC_PER_STEP = 100

export interface Tag {
  id: string
  name: string
  color: TagColor
  /** An operation with at least one such tag stays out of Cash Flow, P&L and their rollups; its balances do not change. */
  excludeFromAnalytics: boolean
  /** Stays on the operations that have it (muted); a new assignment is refused. */
  archived: boolean
  /** True while the operations of the tag are recalculated after a change of the flag. */
  recalcPending: boolean
}

/** `PATCH /tags/{id}`: the tag after the change, and whether its operations must be recalculated now. */
export interface UpdateTagResult {
  tag: Tag
  recalc: boolean
}

/** `GET /tags/{id}/impact`: the operations that carry the tag. */
export interface TagImpact {
  operations: number
}

/** One step of `POST /tags/{id}/recalculate`. */
export interface RecalcStepResult {
  /** Operations with the tag this step read. */
  scanned: number
  /** Of those, the ones whose `excluded` changed (their rollups moved). */
  changed: number
  done: boolean
  /** The id of the last operation read: send it back for the next step. Null when done. */
  cursor: string | null
}
