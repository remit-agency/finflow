import { isId } from '@/lib/domain/ledger/guards'
import { TX_TYPES, type TxType } from '@/lib/domain/ledger/types'
import { MAX_FILTER_IDS } from '@/lib/domain/journal/filter'

/**
 * The payment types and categories of the reports (S10f, Finmap's tree). The owner of this file is the one place that knows
 * what a stored choice means: `types` holds whole groups (`income`, `expense`, `transfer`), `categoryIds` the other ids: a
 * category, or the uncategorised row of a payment type (`_none:income`, `_none:expense`). An operation matches when its type
 * is a chosen group, or its category is a chosen id, or it is uncategorised and its type's uncategorised row is chosen.
 * Nothing chosen is no restriction. The journal keeps its own AND rule (`matchesJournalKinds`).
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
  /** Every category of the type, at any depth, in the caller's order. */
  members: readonly string[]
}

export interface KindTree<C extends KindCategory> {
  income: KindGroup<C>
  expense: KindGroup<C>
  /** Every category by id, for the rows of the dialog and for the subtrees. */
  nodes: ReadonlyMap<string, KindNode<C>>
}

/**
 * The tree of a company's categories, one group per payment type. A category whose parent is missing (deleted, or of another
 * type) is a root; a loop of parents keeps its categories as roots, so none is hidden. `order` sorts the siblings.
 */
export function buildKindTree<C extends KindCategory>(categories: readonly C[], order: (a: C, b: C) => number = () => 0): KindTree<C> {
  const nodes = new Map<string, KindNode<C>>()
  for (const c of categories) nodes.set(c.id, { category: c, children: [] })
  const parentOf = (c: C): string | undefined => (c.parentId !== undefined && c.parentId !== c.id && nodes.has(c.parentId) ? c.parentId : undefined)
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
    const list = categories.filter((c) => c.type === type).sort(order)
    const roots: KindNode<C>[] = []
    for (const c of list) {
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

/** The normal form of a set of covered keys: a group that is whole becomes its type; the rest stays as ids. */
function fromKeys<C extends KindCategory>(keys: Set<string>, transfer: boolean, tree: KindTree<C>): KindToggle {
  const types: TxType[] = []
  const rest = new Set(keys)
  for (const type of GROUPS) {
    const members = memberKeys(tree, type)
    if (members.every((k) => keys.has(k))) {
      types.push(type)
      for (const k of members) rest.delete(k)
    }
  }
  if (transfer) types.push('transfer')
  if (TX_TYPES.every((t) => types.includes(t))) return { ok: true, selection: { types: [], categoryIds: [] } }
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

/** The normal form of a choice read from the address (a hand-made link may hold a whole group as ids). Same meaning. */
export function normaliseKinds<C extends KindCategory>(sel: KindSelection, tree: KindTree<C>): KindSelection {
  const result = fromKeys(coveredKeys(sel, tree), sel.types.includes('transfer'), tree)
  // Only ids the address already held can remain, so the 30 limit cannot be exceeded here.
  return result.ok ? result.selection : sel
}

/**
 * The union rule of the reports: an operation matches when its type is a chosen group (or transfers), or its category is a
 * chosen id, or it has no category and its type's uncategorised row is chosen. Nothing chosen matches everything.
 */
export function matchesAnalyticsKinds(tx: { type: TxType; categoryId?: string }, sel: KindSelection): boolean {
  if (sel.types.length === 0 && sel.categoryIds.length === 0) return true
  if (sel.types.includes(tx.type)) return true
  const key = tx.categoryId ?? (tx.type === 'transfer' ? undefined : noCategoryId(tx.type))
  return key !== undefined && sel.categoryIds.includes(key)
}
