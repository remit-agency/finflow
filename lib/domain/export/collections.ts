// The collections a company export contains. A CLOSED list: derived and technical collections (rollups, ledger,
// counterpartyKeys, tagKeys, bankSeen, bankAccounts, recurringDone, importLocks) are rebuilt from these and are not
// exported. `organization` is the company document itself.
export const EXPORT_COLLECTIONS = ['organization', 'members', 'accounts', 'categories', 'counterparties', 'tags', 'transactions', 'rules', 'recurring', 'imports', 'audit', 'bankConnections'] as const
export type ExportCollection = (typeof EXPORT_COLLECTIONS)[number]
export function isExportCollection(v: unknown): v is ExportCollection {
  return typeof v === 'string' && (EXPORT_COLLECTIONS as readonly string[]).includes(v)
}

/**
 * The body of the "export finished" call: documents read per collection. Every key must be an export collection and every
 * value a non-negative integer; a collection may be left out. Null for anything else (nothing is guessed or dropped).
 */
export function parseExportCounts(body: unknown): Partial<Record<ExportCollection, number>> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const counts = (body as Record<string, unknown>).counts
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) return null
  const out: Partial<Record<ExportCollection, number>> = {}
  for (const [key, value] of Object.entries(counts)) {
    if (!isExportCollection(key) || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
    out[key] = value
  }
  return out
}

export const EXPORT_PAGE_DOCS = 500
export const EXPORT_PAGE_BYTES = 900_000
