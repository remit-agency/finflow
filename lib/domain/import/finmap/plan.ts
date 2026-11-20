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
  /** Position among the accepted rows, which is sheet order. */
  pos: number
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
  /** Set on the earlier row of a transfer pair. */
  partner: Cand | null
  /** Set on the later row of a transfer pair: it is written inside the transfer. */
  folded: boolean
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
 * One transfer from two rows (`first` is the earlier row in the sheet). The expense row gives the source account and the
 * amount and the description (its comment, else the income's); the tags are the union in sheet order. Accruals and categories
 * do not carry over, so a folded row's valid accrual is counted as ignored.
 */
function transferOp(first: Cand, second: Cand, warnings: Warnings): PlannedOp {
  const exp = first.kind === 'expense' ? first : second
  const inc = exp === first ? second : first
  const tags: string[] = []
  const seenTag = new Set<string>()
  for (const t of [...first.tags, ...second.tags]) {
    if (!seenTag.has(normKey(t))) {
      seenTag.add(normKey(t))
      tags.push(t)
    }
  }
  if (first.accrual !== null) warnings.accrualIgnored++
  if (second.accrual !== null) warnings.accrualIgnored++
  return {
    kind: 'transfer',
    status: 'actual',
    day: exp.day,
    amountMinor: exp.amountMinor,
    account: exp.account,
    toAccount: inc.account,
    toAmountMinor: null,
    category: null,
    counterparty: null,
    tags,
    description: cutComment(exp.comment ?? inc.comment, warnings),
    accrual: null,
    identity: [...finmapIdentity(exp.row), '+', ...finmapIdentity(inc.row)],
    ordinal: 0,
    lines: [first.row.line, second.row.line],
  }
}

/**
 * Pairs transfers among the actual rows. A group of the same day, minute and amount holding exactly one expense and one
 * income on different accounts with the same currency becomes a transfer when neither side has a real category or a
 * counterparty. Returns the number of such groups that were not paired only for those reasons (`pairCandidatesLeft`).
 * Groups are kept in a Map in sheet order, so the result does not depend on anything but the rows.
 */
function pairOperations(cands: Cand[], currencyOf: (account: string) => string): number {
  const groups = new Map<string, { expenses: Cand[]; incomes: Cand[] }>()
  for (const c of cands) {
    if (c.status !== 'actual') continue
    const key = `${c.day}|${c.row.minute}|${c.amountMinor}`
    let g = groups.get(key)
    if (g === undefined) {
      g = { expenses: [], incomes: [] }
      groups.set(key, g)
    }
    if (c.kind === 'expense') g.expenses.push(c)
    else g.incomes.push(c)
  }
  let left = 0
  for (const { expenses, incomes } of groups.values()) {
    if (expenses.length !== 1 || incomes.length !== 1) continue
    const e = expenses[0]
    const i = incomes[0]
    if (normKey(e.account) === normKey(i.account)) continue
    if (currencyOf(e.account) !== currencyOf(i.account)) continue
    const plain = (c: Cand): boolean => c.category === null && c.counterparty === null
    if (plain(e) && plain(i)) {
      const first = e.pos < i.pos ? e : i
      const second = first === e ? i : e
      first.partner = second
      second.folded = true
    } else {
      left++
    }
  }
  return left
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
  const noteName = (group: 'accounts' | 'counterparties' | 'tags', name: string, known: ReadonlySet<string>): void => {
    const k = normKey(name)
    if (known.has(k)) {
      matchedKeys[group].add(k)
    } else if (!seen.has(`${group}|${k}`)) {
      seen.add(`${group}|${k}`)
      create[group].push(name)
    }
  }
  const parentSpelling = new Map<string, string>()
  const noteCategory = (ref: CategoryRef): void => {
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
    noteName('accounts', op.account, accountKeys)
    if (op.toAccount !== null) noteName('accounts', op.toAccount, accountKeys)
    if (op.category !== null) noteCategory(op.category)
    if (op.counterparty !== null) noteName('counterparties', op.counterparty, counterpartyKeys)
    for (const tag of op.tags) noteName('tags', tag, tagKeys)
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
      row, pos: cands.length, kind, status, day, account, amountMinor: amount, category: category.ref,
      counterparty: row.counterparty, tags: row.tags, comment: row.comment, accrual, partner: null, folded: false,
    })
  }

  const currencyByKey = new Map<string, string>()
  for (const a of existing.accounts) {
    const k = normKey(a.name)
    if (!currencyByKey.has(k)) currencyByKey.set(k, a.currency)
  }
  const currencyOf = (account: string): string => {
    const k = normKey(account)
    return currencyByKey.get(k) ?? options.newAccountCurrency?.[k] ?? existing.companyCurrency
  }
  // With pairing off, no group is looked at, so `pairCandidatesLeft` is 0.
  const pairCandidatesLeft = options.pairTransfers ? pairOperations(cands, currencyOf) : 0

  // A transfer sits at the position of its first row in the sheet (the earlier of its two rows), and the ordinals below are
  // numbered in this order, so the same file always gives the same keys.
  const operations: PlannedOp[] = []
  for (const c of cands) {
    if (c.folded) continue
    operations.push(c.partner === null ? singleOp(c, warnings) : transferOp(c, c.partner, warnings))
  }
  numberOrdinals(operations)

  const counts: FinmapCounts = {
    rows: rows.length, income: 0, expense: 0, transfer: 0, planned: 0, pairCandidatesLeft, refused, warnings,
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
