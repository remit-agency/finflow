import 'server-only'
import type { BankOpView } from '@/lib/domain/import/plan'
import { judgeOp, overlapsBank } from '@/lib/domain/import/plan'
import { normalizeSource, parseMt940 } from '@/lib/domain/import/mt940'
import type { PreviewRequest } from '@/lib/domain/import/request'
import { MAX_IMPORT_BYTES, MAX_IMPORT_OPS, type ImportOp, type OpStatus, type ParseIssue, type ParsedStatement, type RefusalReason, type StatementBalance } from '@/lib/domain/import/types'
import { bankAccountsCol } from '@/lib/server/banking/paths'
import { parseBankAccount, type BankAccount } from '@/lib/server/banking/types'
import { accountsCol } from '@/lib/server/ledger/paths'
import { bankOpsOf, seenKeysOf } from './bank-ops'
import type { ImportDeps } from './deps'
import { ImportError } from './errors'
import { importKey } from './key'
import { importsCol } from './paths'
import { loadAccount } from './step'
import { parseImportDoc, type ImportDoc } from './types'

/** The latest import documents searched for the account of a statement's source (S14). */
const RECENT_IMPORTS = 20

export interface PreviewStatement {
  index: number
  /** `:25:` normalized (an IBAN when it is one); null when the file has none. */
  source: string | null
  number: string | null
  currency: string | null
  opening: StatementBalance | null
  closing: StatementBalance | null
  /** Day of the first and of the last operation; null when the statement has none. */
  from: string | null
  to: string | null
  reconciliation: number | null
  /** The account this statement most likely belongs to (its source seen in an import or an active bank account); null when unknown. */
  suggestedAccountId: string | null
  /** Present when the caller chose an account for this statement. */
  chosen?: { accountId: string; accountCurrency: string; balanceMinor: number; counts: { new: number; seen: number; bank: number; refused: number } }
  /** With a chosen account every operation has its status; without one none does. */
  operations: Array<ImportOp & { status?: OpStatus }>
}

export interface PreviewResult {
  statements: PreviewStatement[]
  issues: ParseIssue[]
  opCount: number
}

/**
 * Reads a statement file without writing anything (S14). Without `accountIds` it parses and suggests an account per
 * statement; with `accountIds` (one per statement, null for none) it also marks every operation new, seen, bank or refused,
 * with the same decision order as the write step. Safe to call any number of times.
 */
export async function previewImport(deps: ImportDeps, orgId: string, req: PreviewRequest): Promise<PreviewResult> {
  if (req.text.length > MAX_IMPORT_BYTES) throw new ImportError('payload_too_large')
  const parsed = parseMt940(req.text)
  if (parsed.statements.length === 0) throw new ImportError('invalid_input', 'file')
  const opCount = parsed.statements.reduce((n, s) => n + s.operations.length, 0)
  if (opCount > MAX_IMPORT_OPS) throw new ImportError('too_many_operations')
  if (req.accountIds !== undefined && req.accountIds.length !== parsed.statements.length) throw new ImportError('invalid_input', 'accountIds')

  const suggestions = await suggestAccounts(deps, orgId, parsed.statements.map((s) => s.source))
  const statements: PreviewStatement[] = []
  for (let i = 0; i < parsed.statements.length; i++) {
    const stmt = parsed.statements[i]
    const chosenId = req.accountIds?.[i] ?? null
    statements.push(chosenId === null ? withoutChoice(stmt, suggestions[i]) : await withChoice(deps, orgId, stmt, suggestions[i], chosenId))
  }
  return { statements, issues: parsed.issues, opCount }
}

function dayRange(ops: readonly ImportOp[]): { from: string | null; to: string | null } {
  if (ops.length === 0) return { from: null, to: null }
  const days = ops.map((op) => op.day).sort()
  return { from: days[0], to: days[days.length - 1] }
}

function describeStatement(stmt: ParsedStatement, suggestedAccountId: string | null): Omit<PreviewStatement, 'operations' | 'chosen'> {
  return { index: stmt.index, source: stmt.source, number: stmt.number, currency: stmt.currency, opening: stmt.opening, closing: stmt.closing, ...dayRange(stmt.operations), reconciliation: stmt.reconciliation, suggestedAccountId }
}

function withoutChoice(stmt: ParsedStatement, suggestedAccountId: string | null): PreviewStatement {
  return { ...describeStatement(stmt, suggestedAccountId), operations: stmt.operations }
}

/** The status of one operation of a chosen account: refusal, then seen (marked), then bank (overlap), else new. */
function statusOf(reason: RefusalReason | null, key: string, op: ImportOp, seen: ReadonlySet<string>, bankOps: ReadonlyMap<string, BankOpView[]>): OpStatus {
  if (reason !== null) return `refused:${reason}`
  if (seen.has(key)) return 'seen'
  if (overlapsBank(op, bankOps.get(op.day) ?? [])) return 'bank'
  return 'new'
}

async function withChoice(deps: ImportDeps, orgId: string, stmt: ParsedStatement, suggestedAccountId: string | null, accountId: string): Promise<PreviewStatement> {
  const account = await loadAccount(deps, orgId, accountId)
  const today = deps.today()
  const reasons = stmt.operations.map((op) => judgeOp(op, { accountCurrency: account.currency, statementCurrency: stmt.currency, today }))
  const keys = stmt.operations.map((op) => importKey(account.id, op))
  const liveKeys = keys.filter((_, i) => reasons[i] === null)
  const seen = await seenKeysOf(deps.db, orgId, liveKeys)
  const range = dayRange(stmt.operations)
  const bankOps = range.from !== null && range.to !== null && liveKeys.length > 0 ? await bankOpsOf(deps.db, orgId, account.id, range.from, range.to) : new Map<string, BankOpView[]>()

  const statuses = stmt.operations.map((op, i) => statusOf(reasons[i], keys[i], op, seen, bankOps))
  return {
    ...describeStatement(stmt, suggestedAccountId),
    chosen: { accountId: account.id, accountCurrency: account.currency, balanceMinor: account.balanceMinor, counts: tally(statuses) },
    operations: stmt.operations.map((op, i) => ({ ...op, status: statuses[i] })),
  }
}

function tally(statuses: readonly OpStatus[]): { new: number; seen: number; bank: number; refused: number } {
  const counts = { new: 0, seen: 0, bank: 0, refused: 0 }
  for (const status of statuses) {
    if (status === 'new' || status === 'seen' || status === 'bank') counts[status]++
    else counts.refused++
  }
  return counts
}

/**
 * The account suggested for each statement: the account of the same source in the latest imports (newest first), else the
 * account of an active bank account whose IBAN is the source. Only accounts that still exist are suggested.
 */
async function suggestAccounts(deps: ImportDeps, orgId: string, sources: ReadonlyArray<string | null>): Promise<Array<string | null>> {
  if (sources.every((s) => s === null)) return sources.map(() => null)
  const recent = await importsCol(deps.db, orgId).orderBy('createdAt', 'desc').limit(RECENT_IMPORTS).get()
  const imports = recent.docs.map((d) => parseImportDoc(d.data())).filter((d): d is ImportDoc => d !== null)
  const bankAccounts = (await bankAccountsCol(deps.db, orgId).where('status', '==', 'active').get()).docs
    .map((d) => parseBankAccount(d.data()))
    .filter((b): b is BankAccount => b !== null && b.status === 'active')

  const candidates = sources.map((source) => {
    if (source === null) return []
    const fromImports = imports.flatMap((doc) => doc.statements.filter((s) => s.source === source).map((s) => s.accountId))
    const fromBank = bankAccounts.filter((b) => b.iban !== null && normalizeSource(b.iban) === source).map((b) => b.accountId)
    return [...fromImports, ...fromBank]
  })
  const existing = await existingAccountIds(deps, orgId, [...new Set(candidates.flat())])
  return candidates.map((list) => list.find((id) => existing.has(id)) ?? null)
}

async function existingAccountIds(deps: ImportDeps, orgId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const col = accountsCol(deps.db, orgId)
  const snaps = await deps.db.getAll(...ids.map((id) => col.doc(id)))
  return new Set(snaps.filter((s) => s.exists).map((s) => s.id))
}
