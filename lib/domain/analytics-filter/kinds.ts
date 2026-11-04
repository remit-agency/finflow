import { isId } from '@/lib/domain/ledger/guards'
import type { TxType } from '@/lib/domain/ledger/types'
import { MAX_FILTER_IDS } from '@/lib/domain/journal/filter'

/**
 * The payment types and categories of the reports (S10f, Finmap's tree). The owner of this file is the one place that knows
 * what a stored choice means: `types` holds whole groups (`income`, `expense`, `transfer`), `categoryIds` the other ids: a
 * category, or the uncategorised row of a payment type (`_none:income`, `_none:expense`). An operation matches when its type
 * is a chosen group, or its row is a chosen id; its row is `kindRowOf`: its category while the company has it with the
 * operation's type, else the uncategorised row of its type. Nothing chosen is no restriction. The journal keeps its own AND
 * rule (`matchesJournalKinds`).
 */

/** The payment types that have categories; `transfer` is a row of its own. */
export type KindGroupType = Exclude<TxType, 'transfer'>
const GROUPS: readonly KindGroupType[] = ['income', 'expense']

/** The uncategorised row of a payment type: `_none:income`. Category ids never contain a colon (`isId`), so it cannot clash. */
const NO_CATEGORY_PREFIX = '_none:'

export function noCategoryId(type: KindGroupType): string {
  return `${NO_CATEGORY_PREFIX}${type}`
}

/** The payment type of an uncategorised-row id, or `undefined` for any other text (matched exactly, never by a substring). */
export function parseNoCategoryId(id: string): KindGroupType | undefined {
  return GROUPS.find((type) => id === noCategoryId(type))
}

/** What the category list of the address may hold: a category id or an uncategorised row. */
export function isKindListItem(s: string): boolean {
  return parseNoCategoryId(s) !== undefined || isId(s)
}

/** The stored choice: whole groups and the other ids (categories and uncategorised rows). */
export interface KindSelection {
  types: TxType[]
  categoryIds: string[]
}

/** The tri-state of a row: checked, partly chosen (the dash), or not chosen. */
export type TriState = 'checked' | 'mixed' | 'unchecked'

/** The minimum a category needs for the tree; the caller's category type carries more (a name, a colour). */
export interface KindCategory {
  id: string
  type: KindGroupType
  parentId?: string
}

export interface KindNode<C extends KindCategory> {
  category: C
  children: KindNode<C>[]
}

export interface KindGroup<C extends KindCategory> {
  roots: KindNode<C>[]
  /**
   * Every category of the type, at any depth, in the caller's order: the order the stored ids are written in. The dialog and the
   * hook read the same list, so they write and normalise to one order and a normal form is never rewritten for its order alone.
   */
  members: readonly string[]
}

export interface KindTree<C extends KindCategory> {
  income: KindGroup<C>
  expense: KindGroup<C>
  /** Every category by id, for the rows of the dialog and for the subtrees. */
  nodes: ReadonlyMap<string, KindNode<C>>
}

/**
 * The tree of a company's categories, one group per payment type. A category whose parent is missing (deleted) or of the other
 * type is a root of its group: a parent of another type is not its parent. A loop of parents keeps its categories as roots, so
 * none is hidden. `order` sorts the siblings.
 */
export function buildKindTree<C extends KindCategory>(categories: readonly C[], order: (a: C, b: C) => number = () => 0): KindTree<C> {
  const nodes = new Map<string, KindNode<C>>()
  for (const c of categories) nodes.set(c.id, { category: c, children: [] })
  const parentOf = (c: C): string | undefined => {
    if (c.parentId === undefined || c.parentId === c.id) return undefined
    const parent = nodes.get(c.parentId)
    return parent !== undefined && parent.category.type === c.type ? c.parentId : undefined
  }
  // A category is a root when walking up its parents comes back to it (a loop).
  const inLoop = (c: C): boolean => {
    const seen = new Set<string>()
    let p = parentOf(c)
    while (p !== undefined && !seen.has(p)) {
      if (p === c.id) return true
      seen.add(p)
      p = parentOf(nodes.get(p)!.category)
    }
    return false
  }
  const group = (type: KindGroupType): KindGroup<C> => {
    const list = categories.filter((c) => c.type === type)
    const roots: KindNode<C>[] = []
    for (const c of [...list].sort(order)) {
      const node = nodes.get(c.id)!
      const parent = parentOf(c)
      if (parent !== undefined && !inLoop(c)) nodes.get(parent)!.children.push(node)
      else roots.push(node)
    }
    return { roots, members: list.map((c) => c.id) }
  }
  return { income: group('income'), expense: group('expense'), nodes }
}

/** A row of the tree (or the transfers): what a tick on it means. */
export type KindRef = { kind: 'transfer' } | { kind: 'group'; type: KindGroupType } | { kind: 'uncategorised'; type: KindGroupType } | { kind: 'category'; id: string }

function memberKeys<C extends KindCategory>(tree: KindTree<C>, type: KindGroupType): string[] {
  return [...tree[type].members, noCategoryId(type)]
}

function subtreeIds<C extends KindCategory>(node: KindNode<C>): string[] {
  return [node.category.id, ...node.children.flatMap(subtreeIds)]
}

/** The category ids of a row and of its descendants (an unknown id stands for itself). */
function rowIds<C extends KindCategory>(tree: KindTree<C>, id: string): string[] {
  const node = tree.nodes.get(id)
  return node ? subtreeIds(node) : [id]
}

/** Every category and uncategorised id the choice covers: a chosen group contributes all of its members. */
function coveredKeys<C extends KindCategory>(sel: KindSelection, tree: KindTree<C>): Set<string> {
  const keys = new Set(sel.categoryIds)
  for (const type of GROUPS) if (sel.types.includes(type)) for (const k of memberKeys(tree, type)) keys.add(k)
  return keys
}

/** The root row («Усі види платежів і категорії»): checked while nothing is restricted, dashed otherwise. */
export function rootState(sel: KindSelection): TriState {
  return sel.types.length === 0 && sel.categoryIds.length === 0 ? 'checked' : 'mixed'
}

/** The tri-state of a row, derived from the stored choice and the tree (never stored). */
export function kindState<C extends KindCategory>(sel: KindSelection, tree: KindTree<C>, ref: KindRef): TriState {
  if (ref.kind === 'transfer') return sel.types.includes('transfer') ? 'checked' : 'unchecked'
  const keys = coveredKeys(sel, tree)
  if (ref.kind === 'uncategorised') return keys.has(noCategoryId(ref.type)) ? 'checked' : 'unchecked'
  const ids = ref.kind === 'group' ? memberKeys(tree, ref.type) : rowIds(tree, ref.id)
  const picked = ids.filter((id) => keys.has(id)).length
  if (picked === 0) return 'unchecked'
  return picked === ids.length ? 'checked' : 'mixed'
}

export type KindToggle = { ok: true; selection: KindSelection } | { ok: false; reason: 'limit' }

/**
 * The normal form of a set of covered keys. A group is stored as its type only when it has at least one category and every one
 * of them, and its uncategorised row, is covered. A group with no categories never collapses: its uncategorised row alone would
 * stand for the whole type, and a category created later would be taken in by a choice that never named it. When every group
 * and the transfers are covered there is no restriction at all. The rest stays as ids.
 */
function fromKeys<C extends KindCategory>(keys: Set<string>, transfer: boolean, tree: KindTree<C>): KindToggle {
  const covered = (type: KindGroupType): boolean => memberKeys(tree, type).every((k) => keys.has(k))
  if (transfer && GROUPS.every(covered)) return { ok: true, selection: { types: [], categoryIds: [] } }
  const types: TxType[] = []
  const rest = new Set(keys)
  for (const type of GROUPS) {
    if (tree[type].members.length > 0 && covered(type)) {
      types.push(type)
      for (const k of memberKeys(tree, type)) rest.delete(k)
    }
  }
  if (transfer) types.push('transfer')
  // The ids in the tree's order (income, then expense, the uncategorised row last), the ones the tree does not know after.
  const order = [...memberKeys(tree, 'income'), ...memberKeys(tree, 'expense')]
  const ordered = order.filter((k) => rest.has(k))
  const orderedSet = new Set(ordered)
  const categoryIds = [...ordered, ...[...rest].filter((k) => !orderedSet.has(k))]
  if (categoryIds.length > MAX_FILTER_IDS) return { ok: false, reason: 'limit' }
  return { ok: true, selection: { types, categoryIds } }
}

/**
 * A tick on a row: `on` is the state the row goes to. A group, a category with its descendants, or an uncategorised row
 * changes every id it covers. Refused (not cut) when the address could not keep the result.
 */
export function toggleKind<C extends KindCategory>(sel: KindSelection, tree: KindTree<C>, ref: KindRef, on: boolean): KindToggle {
  const keys = coveredKeys(sel, tree)
  let transfer = sel.types.includes('transfer')
  const put = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (on) keys.add(id)
      else keys.delete(id)
    }
  }
  switch (ref.kind) {
    case 'transfer':
      transfer = on
      break
    case 'group':
      put(memberKeys(tree, ref.type))
      break
    case 'uncategorised':
      put([noCategoryId(ref.type)])
      break
    case 'category':
      put(rowIds(tree, ref.id))
      break
  }
  return fromKeys(keys, transfer, tree)
}

/**
 * The rows the person sees as chosen: each group and transfer chosen, and each category or uncategorised row chosen whose
 * parent is not (a tick on a parent covers its children, so they are not rows of their own). A stored id the company does not
 * have (deleted, or from an old link) is one row. What the field's summary counts.
 */
export function topChoices<C extends KindCategory>(sel: KindSelection, tree: KindTree<C>): KindRef[] {
  const refs: KindRef[] = []
  for (const type of GROUPS) if (sel.types.includes(type)) refs.push({ kind: 'group', type })
  if (sel.types.includes('transfer')) refs.push({ kind: 'transfer' })
  const chosen = new Set(sel.categoryIds)
  const visit = (node: KindNode<C>): void => {
    if (chosen.has(node.category.id)) refs.push({ kind: 'category', id: node.category.id })
    else node.children.forEach(visit)
  }
  for (const type of GROUPS) {
    if (sel.types.includes(type)) continue
    tree[type].roots.forEach(visit)
    if (chosen.has(noCategoryId(type))) refs.push({ kind: 'uncategorised', type })
  }
  for (const id of sel.categoryIds) {
    if (!tree.nodes.has(id) && parseNoCategoryId(id) === undefined) refs.push({ kind: 'category', id })
  }
  return refs
}

/** The normal form of a choice read from the address (a hand-made link may hold a whole group as ids). Same meaning. */
export function normaliseKinds<C extends KindCategory>(sel: KindSelection, tree: KindTree<C>): KindSelection {
  const result = fromKeys(coveredKeys(sel, tree), sel.types.includes('transfer'), tree)
  // Only ids the address already held can remain, so the 30 limit cannot be exceeded here.
  return result.ok ? result.selection : sel
}

/** The company's categories as the rules read them: each id with its payment type. */
export type CategoryTypes = ReadonlyMap<string, KindGroupType>

export function categoryTypesOf(categories: readonly KindCategory[]): CategoryTypes {
  return new Map(categories.map((c) => [c.id, c.type]))
}

/**
 * The row an operation counts in: the one rule of the reports, shared by the filter and the P&L (S10f). Its category while the
 * company has that category with the operation's own type. Otherwise its type's uncategorised row: a deleted category (it
 * leaves its id on the operation) and a category of the other type both count as uncategorised. A transfer has no row. While
 * the categories are not loaded (`types` is `undefined`) the stored id stands: unknown is not absent.
 */
export function kindRowOf(tx: { type: TxType; categoryId?: string }, types: CategoryTypes | undefined): string | undefined {
  if (tx.type === 'transfer') return undefined
  if (tx.categoryId === undefined) return noCategoryId(tx.type)
  if (types === undefined) return tx.categoryId
  return types.get(tx.categoryId) === tx.type ? tx.categoryId : noCategoryId(tx.type)
}

/**
 * The union rule of the reports: an operation matches when its type is a chosen group (or transfers), or its row (`kindRowOf`)
 * is a chosen id. Nothing chosen matches everything.
 */
export function matchesAnalyticsKinds(tx: { type: TxType; categoryId?: string }, sel: KindSelection, types: CategoryTypes | undefined): boolean {
  if (sel.types.length === 0 && sel.categoryIds.length === 0) return true
  if (sel.types.includes(tx.type)) return true
  const row = kindRowOf(tx, types)
  return row !== undefined && sel.categoryIds.includes(row)
}
