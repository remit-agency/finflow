import { DEFAULT_TAG_COLOR, TAG_COLORS, type Tag, type TagColor } from './types'

export const TAG_SCHEMA_VERSION = 1

/** The stored fields of a tag (no id, timestamps or orgId: the writer adds those). */
export function tagToDoc(tag: Tag): Record<string, unknown> {
  return {
    schemaVersion: TAG_SCHEMA_VERSION,
    name: tag.name,
    color: tag.color,
    excludeFromAnalytics: tag.excludeFromAnalytics,
    archived: tag.archived,
    recalcPending: tag.recalcPending,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Strict on what the ledger depends on (the name and the two flags), lenient on looks: a colour outside the palette
 * reads as the default one. Null for a document that is not a schema 1 tag.
 */
export function parseTag(id: string, data: unknown): Tag | null {
  if (!isRecord(data) || data.schemaVersion !== TAG_SCHEMA_VERSION) return null
  const { name, color, excludeFromAnalytics, archived, recalcPending } = data
  if (typeof name !== 'string' || name === '') return null
  if (typeof excludeFromAnalytics !== 'boolean' || typeof archived !== 'boolean') return null
  return {
    id,
    name,
    color: (TAG_COLORS as readonly unknown[]).includes(color) ? (color as TagColor) : DEFAULT_TAG_COLOR,
    excludeFromAnalytics,
    archived,
    recalcPending: recalcPending === true,
  }
}
