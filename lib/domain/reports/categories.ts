// lib/domain/reports/categories.ts
// Categories in the reports (S12): the stored document as the server reads it, the tree of «За категоріями» (a parent with
// its subtree, from the S10f tree `buildKindTree`) and the order of the flat P&L rows. The page and the export share them.
import { buildKindTree, noCategoryId, type KindCategory, type KindNode } from '@/lib/domain/analytics-filter/kinds'
import type { MoneyType } from './types'

export interface ReportCategory extends KindCategory {
  name: string
}

/** A stored category (`organizations/{org}/categories/{id}`: name, type, optional parentId), or null when it is not one. */
export function parseReportCategory(id: string, data: unknown): ReportCategory | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.name !== 'string' || (d.type !== 'income' && d.type !== 'expense')) return null
  const out: ReportCategory = { id, name: d.name, type: d.type }
  if (typeof d.parentId === 'string') out.parentId = d.parentId
  return out
}

export interface CategoryTreeRow {
  row: string
  type: MoneyType
  /** 0 for a root, +1 per parent. */
  level: number
  /** The row's own amount plus its subtree's. */
  amountBase: number
}

/**
 * The rows of «За категоріями»: per type the tree in the caller's order, each parent with the sum of its subtree, rows
 * without an amount left out, the uncategorised row last. A row the tree does not know, or of the other type, is
 * uncategorised (the S10f rule; the server already maps a deleted category so, this keeps the page safe from a race).
 */
export function categoryTreeRows<C extends KindCategory>(lines: ReadonlyArray<{ row: string; type: MoneyType; amountBase: number }>, categories: readonly C[]): CategoryTreeRow[] {
  const tree = buildKindTree(categories)
  const out: CategoryTreeRow[] = []
  for (const type of ['income', 'expense'] as const) {
    const none = noCategoryId(type)
    const own = new Map<string, number>()
    for (const line of lines) {
      if (line.type !== type) continue
      const key = line.row !== none && tree.nodes.get(line.row)?.category.type === type ? line.row : none
      own.set(key, (own.get(key) ?? 0) + line.amountBase)
    }
    const totals = new Map<string, number>()
    const totalOf = (node: KindNode<C>): number => {
      const sum = (own.get(node.category.id) ?? 0) + node.children.reduce((s, child) => s + totalOf(child), 0)
      totals.set(node.category.id, sum)
      return sum
    }
    for (const root of tree[type].roots) totalOf(root)
    const walk = (node: KindNode<C>, level: number): void => {
      const amountBase = totals.get(node.category.id) ?? 0
      if (amountBase === 0) return
      out.push({ row: node.category.id, type, level, amountBase })
      for (const child of node.children) walk(child, level + 1)
    }
    for (const root of tree[type].roots) walk(root, 0)
    const rest = own.get(none) ?? 0
    if (rest !== 0) out.push({ row: none, type, level: 0, amountBase: rest })
  }
  return out
}

/** The rank of a flat report row: the categories in the caller's order (`members`), the uncategorised row after them, unknown ids last. */
export function rowRank<C extends KindCategory>(categories: readonly C[]): (type: MoneyType, row: string) => number {
  const tree = buildKindTree(categories)
  const rank = new Map<string, number>()
  for (const type of ['income', 'expense'] as const) tree[type].members.forEach((id, i) => rank.set(`${type}|${id}`, i))
  return (type, row) => rank.get(`${type}|${row}`) ?? (row === noCategoryId(type) ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER)
}
