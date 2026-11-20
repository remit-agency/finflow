import { isDay, monthsBetween } from '@/lib/domain/ledger/days'
import { MAX_PERIOD_MONTHS } from '@/lib/domain/ledger/input'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { normKey } from './fold'
import {
  NO_CATEGORY_NAMES,
  type CategoryRef, type FinmapCounts, type FinmapExisting, type FinmapOptions, type FinmapPlan, type FinmapRefusal, type FinmapRow, type PlannedOp,
} from './types'

const COMMENT_MAX = 500
const NO_CATEGORY_KEYS: ReadonlySet<string> = new Set(NO_CATEGORY_NAMES.map(normKey))

type Warnings = FinmapCounts['warnings']
type RowKind = 'income' | 'expense'

/** A row that is accepted for writing, before pairing. */
interface Cand {
  row: FinmapRow
  kind: RowKind
  status: 'actual' | 'planned'
  day: string
  /** The account name as the file spells it (the source for an expense, the target for an income). */
  account: string
  amountMinor: number
  category: CategoryRef | null
  counterparty: string | null
  tags: string[]
  comment: string | null
  accrual: { from: string; to: string } | null
}

/** The kind a row has by its account side: `from` only is an expense, `to` only an income; otherwise null. */
function rowKind(row: FinmapRow): RowKind | null {
  if (row.from !== null && row.to === null) return 'expense'
  if (row.to !== null && row.from === null) return 'income'
  return null
}

/** The strings that identify a row's operation in its key (a transfer joins its two rows' strings with '+'). */
export function finmapIdentity(row: FinmapRow): string[] {
  return [
    row.timeText,
    String(row.amountMinor),
    rowKind(row) ?? '',
    normKey(row.category ?? ''),
    normKey(row.subcategory ?? ''),
    normKey(row.counterparty ?? ''),
    normKey(row.comment ?? ''),
    row.tags.map(normKey).sort().join('|'),
  ]
}

/** A category reference by names, or null for "no category"; `ignored` when a subcategory has no real category to hang on. */
function categoryOf(row: FinmapRow, kind: RowKind): { ref: CategoryRef | null; ignored: boolean } {
  if (row.category === null || NO_CATEGORY_KEYS.has(normKey(row.category))) {
    return { ref: null, ignored: row.subcategory !== null }
  }
  return { ref: { type: kind, parent: row.category, child: row.subcategory }, ignored: false }
}

/**
 * A period is an accrual when it is a real range of at most MAX_PERIOD_MONTHS months. A span of four or more calendar
 * years is over 36 months (its shortest form is 38), so the month walk is skipped for it.
 */
function periodOk(p: { from: string; to: string }): boolean {
  if (!isDay(p.from) || !isDay(p.to) || p.from > p.to) return false
  if (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4)) > 3) return false
  return monthsBetween(p.from, p.to).length <= MAX_PERIOD_MONTHS
}

/** The comment cut to COMMENT_MAX characters (code points, so a surrogate pair is never split); counted when cut. */
function cutComment(s: string | null, warnings: Warnings): string | null {
  if (s === null || s.length <= COMMENT_MAX) return s
  const chars = [...s]
  if (chars.length <= COMMENT_MAX) return s
  warnings.commentCut++
  return chars.slice(0, COMMENT_MAX).join('')
}

function singleOp(c: Cand, warnings: Warnings): PlannedOp {
  return {
    kind: c.kind,
    status: c.status,
    day: c.day,
    amountMinor: c.amountMinor,
    account: c.account,
    toAccount: null,
    toAmountMinor: null,
    category: c.category,
    counterparty: c.counterparty,
    tags: c.tags,
    description: cutComment(c.comment, warnings),
    accrual: c.accrual,
    identity: finmapIdentity(c.row),
    ordinal: 0,
    lines: [c.row.line],
  }
}

/**
 * Numbers operations that share `(account, toAccount, identity)` in the order of `ops`, from 0. `ops` is in sheet order, so
 * the same file always gives the same numbers.
 */
function numberOrdinals(ops: PlannedOp[]): void {
  const next = new Map<string, number>()
  for (const op of ops) {
    const key = JSON.stringify([normKey(op.account), op.toAccount === null ? null : normKey(op.toAccount), op.identity])
    const n = next.get(key) ?? 0
    op.ordinal = n
    next.set(key, n + 1)
  }
}

const catKey = (type: RowKind, name: string): string => `${type}|${normKey(name)}`

/**
 * What the operations need that FinFlow does not have yet, and what they match. Names are de-duplicated by `normKey`, the
 * first spelling in operation order is kept; a category parent is listed before its children.
 */
function namesOf(ops: PlannedOp[], existing: FinmapExisting): Pick<FinmapPlan, 'create' | 'matched'> {
  const accountKeys = new Set(existing.accounts.map((a) => normKey(a.name)))
  const counterpartyKeys = new Set(existing.counterparties.map((p) => normKey(p.name)))
  const tagKeys = new Set(existing.tags.map((t) => normKey(t.name)))
  const topCats = new Map<string, string>()
  const subCats = new Set<string>()
  for (const c of existing.categories) {
    if (!c.parentId) {
      const k = catKey(c.type, c.name)
      if (!topCats.has(k)) topCats.set(k, c.id)
    } else {
      subCats.add(`${c.parentId}|${normKey(c.name)}`)
    }
  }

  const create: FinmapPlan['create'] = { accounts: [], categories: [], counterparties: [], tags: [] }
  const matchedKeys = { accounts: new Set<string>(), categories: new Set<string>(), counterparties: new Set<string>(), tags: new Set<string>() }
  const seen = new Set<string>()
  const useName = (group: 'accounts' | 'counterparties' | 'tags', name: string, known: ReadonlySet<string>): void => {
    const k = normKey(name)
    if (known.has(k)) {
      matchedKeys[group].add(k)
    } else if (!seen.has(`${group}|${k}`)) {
      seen.add(`${group}|${k}`)
      create[group].push(name)
    }
  }
  const parentSpelling = new Map<string, string>()
  const useCategory = (ref: CategoryRef): void => {
    const pk = catKey(ref.type, ref.parent)
    let parent = parentSpelling.get(pk)
    if (parent === undefined) {
      parent = ref.parent
      parentSpelling.set(pk, parent)
    }
    const parentId = topCats.get(pk)
    if (parentId !== undefined) {
      matchedKeys.categories.add(`p|${pk}`)
    } else if (!seen.has(`cat|${pk}`)) {
      seen.add(`cat|${pk}`)
      create.categories.push({ type: ref.type, parent, child: null })
    }
    if (ref.child === null) return
    const ck = `${pk}|${normKey(ref.child)}`
    if (parentId !== undefined && subCats.has(`${parentId}|${normKey(ref.child)}`)) {
      matchedKeys.categories.add(`c|${ck}`)
    } else if (!seen.has(`cat|${ck}`)) {
      seen.add(`cat|${ck}`)
      create.categories.push({ type: ref.type, parent, child: ref.child })
    }
  }

  for (const op of ops) {
    useName('accounts', op.account, accountKeys)
    if (op.toAccount !== null) useName('accounts', op.toAccount, accountKeys)
    if (op.category !== null) useCategory(op.category)
    if (op.counterparty !== null) useName('counterparties', op.counterparty, counterpartyKeys)
    for (const tag of op.tags) useName('tags', tag, tagKeys)
  }
  return {
    create,
    matched: {
      accounts: matchedKeys.accounts.size,
      categories: matchedKeys.categories.size,
      counterparties: matchedKeys.counterparties.size,
      tags: matchedKeys.tags.size,
    },
  }
}

/**
 * The Finmap plan: pure and deterministic. Every row is either refused (with its reason) or part of one operation, so
 * `income + expense + 2 * transfer + refused` equals the number of rows.
 */
export function planFinmap(rows: readonly FinmapRow[], existing: FinmapExisting, options: FinmapOptions): FinmapPlan {
  const refused: Partial<Record<FinmapRefusal, number>> = {}
  const refuse = (reason: FinmapRefusal): void => {
    refused[reason] = (refused[reason] ?? 0) + 1
  }
  const warnings: Warnings = { commentCut: 0, subcounterparty: 0, project: 0, accrualIgnored: 0, categoryIgnored: 0 }

  const cands: Cand[] = []
  for (const row of rows) {
    const day = row.paymentDay
    const amount = row.amountMinor
    const kind = rowKind(row)
    const account = kind === 'expense' ? row.from : kind === 'income' ? row.to : null
    if (!isDay(day)) {
      refuse('date')
      continue
    }
    if (amount === null || amount <= 0 || amount > MAX_MINOR) {
      refuse('amount')
      continue
    }
    if (kind === null || account === null) {
      refuse('account')
      continue
    }
    const status = day > options.today ? 'planned' : 'actual'
    if (status === 'planned' && !options.includePlanned) {
      refuse('planned_off')
      continue
    }
    const category = categoryOf(row, kind)
    if (category.ignored) warnings.categoryIgnored++
    if (row.hasSubcounterparty) warnings.subcounterparty++
    if (row.hasProject) warnings.project++
    let accrual: Cand['accrual'] = null
    if (row.period !== null) {
      if (periodOk(row.period)) accrual = { from: row.period.from, to: row.period.to }
      else warnings.accrualIgnored++
    }
    cands.push({
      row, kind, status, day, account, amountMinor: amount, category: category.ref,
      counterparty: row.counterparty, tags: row.tags, comment: row.comment, accrual,
    })
  }

  const operations = cands.map((c) => singleOp(c, warnings))
  numberOrdinals(operations)

  const counts: FinmapCounts = {
    rows: rows.length, income: 0, expense: 0, transfer: 0, planned: 0, pairCandidatesLeft: 0, refused, warnings,
  }
  let from: string | null = null
  let to: string | null = null
  for (const op of operations) {
    counts[op.kind]++
    if (op.status === 'planned') counts.planned++
    if (from === null || op.day < from) from = op.day
    if (to === null || op.day > to) to = op.day
  }
  return {
    operations,
    period: from === null || to === null ? null : { from, to },
    ...namesOf(operations, existing),
    counts,
  }
}
