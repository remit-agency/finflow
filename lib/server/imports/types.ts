import { Timestamp } from 'firebase-admin/firestore'
import { isDay } from '@/lib/domain/ledger/days'
import { MAX_MINOR, isMinor } from '@/lib/domain/ledger/money'
import type {
  ImportCounts,
  ImportEntityCounts,
  ImportKind,
  ImportPeriod,
  ImportStatementRef,
  ImportStatus,
  ImportUndoCounts,
  ImportView,
} from '@/lib/domain/import/view'

export type { ImportEntityCounts, ImportKind, ImportStatus, ImportView }
/** Per account: was it empty when the import first touched it ('pending' = fit its opening balance at the end). */
export type FitState = 'pending' | 'no' | 'done'

/** organizations/{org}/imports/{id}: one per file run (S14, S14b). */
export interface ImportDoc {
  schemaVersion: 1
  kind: ImportKind
  fileName: string
  accountIds: string[]
  createdAt: Timestamp
  createdBy: string
  period: ImportPeriod
  counts: ImportCounts
  /** One entry per statement written: its source (`:25:`), the account it went to and its period. */
  statements: ImportStatementRef[]
  fit: Record<string, FitState>
  /** Finmap only: account id → the balance the user typed for it, fitted at finish (minor units). */
  fitTargets: Record<string, number>
  entities: ImportEntityCounts
  status: ImportStatus
  undoneAt?: Timestamp
  undo: ImportUndoCounts
}

const STATUSES: readonly string[] = ['applied', 'undoing', 'undone']
const FITS: readonly string[] = ['pending', 'no', 'done']
const KINDS: readonly string[] = ['mt940', 'finmap']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')
const count = (v: unknown): number | undefined => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : undefined)
const nullableDay = (v: unknown): string | null | undefined => (v === null ? null : isDay(v) ? v : undefined)

/** A document written before S14b has no kind: it is an MT940 import. */
function parseKind(v: unknown): ImportKind | null {
  if (v === undefined) return 'mt940'
  return typeof v === 'string' && KINDS.includes(v) ? (v as ImportKind) : null
}

/** Absent means no targets. Each target is a safe minor amount inside the ledger range. */
function parseFitTargets(v: unknown): Record<string, number> | null {
  if (v === undefined) return {}
  if (!isRecord(v)) return null
  const out: Record<string, number> = {}
  for (const [accountId, minor] of Object.entries(v)) {
    if (!isMinor(minor) || Math.abs(minor) > MAX_MINOR) return null
    out[accountId] = minor
  }
  return out
}

/** Absent means no entities were created (a document written before S14b). When present, all four counts are required. */
function parseEntities(v: unknown): ImportEntityCounts | null {
  if (v === undefined) return { accounts: 0, categories: 0, counterparties: 0, tags: 0 }
  if (!isRecord(v)) return null
  const accounts = count(v.accounts)
  const categories = count(v.categories)
  const counterparties = count(v.counterparties)
  const tags = count(v.tags)
  return accounts === undefined || categories === undefined || counterparties === undefined || tags === undefined
    ? null
    : { accounts, categories, counterparties, tags }
}

function parseCounts(v: unknown): { created: number; skipped: number; refused: number } | null {
  if (!isRecord(v)) return null
  const created = count(v.created)
  const skipped = count(v.skipped)
  const refused = count(v.refused)
  return created === undefined || skipped === undefined || refused === undefined ? null : { created, skipped, refused }
}

function parseUndo(v: unknown): { deleted: number; kept: number } | null {
  // A document written before the undo existed has no counts yet: they start at zero.
  if (v === undefined) return { deleted: 0, kept: 0 }
  if (!isRecord(v)) return null
  const deleted = count(v.deleted)
  const kept = count(v.kept)
  return deleted === undefined || kept === undefined ? null : { deleted, kept }
}

function parsePeriod(v: unknown): ImportDoc['period'] | null {
  if (!isRecord(v)) return null
  const from = nullableDay(v.from)
  const to = nullableDay(v.to)
  return from === undefined || to === undefined ? null : { from, to }
}

function parseStatements(v: unknown): ImportDoc['statements'] | null {
  if (!Array.isArray(v)) return null
  const out: ImportDoc['statements'] = []
  for (const s of v) {
    if (!isRecord(s)) return null
    const source = s.source === null || typeof s.source === 'string' ? (s.source as string | null) : undefined
    const from = nullableDay(s.from)
    const to = nullableDay(s.to)
    if (source === undefined || typeof s.accountId !== 'string' || from === undefined || to === undefined) return null
    out.push({ source, accountId: s.accountId, from, to })
  }
  return out
}

function parseFit(v: unknown): Record<string, FitState> | null {
  if (!isRecord(v)) return null
  const out: Record<string, FitState> = {}
  for (const [accountId, state] of Object.entries(v)) {
    if (typeof state !== 'string' || !FITS.includes(state)) return null
    out[accountId] = state as FitState
  }
  return out
}

/** The stored import document, or null when it is not one (every field checked; a malformed document is unreadable). */
export function parseImportDoc(data: unknown): ImportDoc | null {
  if (!isRecord(data) || data.schemaVersion !== 1) return null
  const { fileName, accountIds, createdAt, createdBy, status } = data
  if (typeof fileName !== 'string' || !isStringArray(accountIds) || !(createdAt instanceof Timestamp) || typeof createdBy !== 'string') return null
  if (typeof status !== 'string' || !STATUSES.includes(status)) return null
  const period = parsePeriod(data.period)
  const counts = parseCounts(data.counts)
  const statements = parseStatements(data.statements)
  const fit = parseFit(data.fit)
  const undo = parseUndo(data.undo)
  const kind = parseKind(data.kind)
  const fitTargets = parseFitTargets(data.fitTargets)
  const entities = parseEntities(data.entities)
  if (!period || !counts || !statements || !fit || !undo || kind === null || fitTargets === null || entities === null) return null
  if (data.undoneAt !== undefined && !(data.undoneAt instanceof Timestamp)) return null
  const doc: ImportDoc = {
    schemaVersion: 1,
    kind,
    fileName,
    accountIds,
    createdAt,
    createdBy,
    period,
    counts,
    statements,
    fit,
    fitTargets,
    entities,
    status: status as ImportStatus,
    undo,
  }
  if (data.undoneAt instanceof Timestamp) doc.undoneAt = data.undoneAt
  return doc
}

/** The import as the API returns it (no fit state, no creator). */
export function importView(id: string, doc: ImportDoc): ImportView {
  const view: ImportView = {
    id,
    kind: doc.kind,
    fileName: doc.fileName,
    createdAt: doc.createdAt.toDate().toISOString(),
    accountIds: doc.accountIds,
    period: doc.period,
    counts: doc.counts,
    entities: doc.entities,
    statements: doc.statements,
    status: doc.status,
    undo: doc.undo,
  }
  if (doc.undoneAt !== undefined) view.undoneAt = doc.undoneAt.toDate().toISOString()
  return view
}
