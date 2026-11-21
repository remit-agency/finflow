import { MAX_TX_TAGS } from '@/lib/domain/tags/types'
import { normKey } from './fold'
import type { BatchOp } from './request'
import type { CategoryRef, FinmapExisting, PlannedOp } from './types'

/** The ids the set-up step returned (the same shape as its response): entities it created, by `normKey` of the requested name. */
export interface ResolveMaps {
  accounts: Record<string, string>
  categories: Array<{ ref: CategoryRef; id: string }>
  counterparties: Record<string, string>
  tags: Record<string, string>
}

export interface ResolvedOps {
  /** One per planned operation, in the same order. */
  ops: BatchOp[]
  /** Tags beyond MAX_TX_TAGS that were left off their operations (the first ones in sheet order are kept). */
  tagsDropped: number
}

/** A record lookup that ignores inherited property names (`constructor`, `toString`). */
const own = (rec: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined

/**
 * Turns the planned operations (by names) into batch operations (by ids) (S14b). Names are looked up by `normKey`: the set-up
 * maps first, then what FinFlow already had. A name with no id is a bug in the plan or the set-up, so this throws instead of
 * dropping the operation; the message names the entity kind and the sheet line, never the name itself. Tags beyond
 * MAX_TX_TAGS are dropped from their operation and counted in `tagsDropped`. The result is one-to-one with `operations`.
 */
export function resolveOps(operations: readonly PlannedOp[], maps: ResolveMaps, existing: FinmapExisting): ResolvedOps {
  const accountsOld = new Map<string, string>()
  for (const a of existing.accounts) if (!accountsOld.has(normKey(a.name))) accountsOld.set(normKey(a.name), a.id)
  const counterpartiesOld = new Map<string, string>()
  for (const p of existing.counterparties) if (!counterpartiesOld.has(normKey(p.name))) counterpartiesOld.set(normKey(p.name), p.id)
  const tagsOld = new Map<string, string>()
  for (const t of existing.tags) if (!tagsOld.has(normKey(t.name))) tagsOld.set(normKey(t.name), t.id)

  // Categories: a top-level one is keyed by `type|parent`, a child by its parent's key and `child`. A child of an existing parent
  // is looked up under the parent's id as well.
  const topIds = new Map<string, string>()
  const existingChildIds = new Map<string, string>()
  for (const c of existing.categories) {
    if (!c.parentId) {
      const k = `${c.type}|${normKey(c.name)}`
      if (!topIds.has(k)) topIds.set(k, c.id)
    } else {
      existingChildIds.set(`${c.parentId}|${normKey(c.name)}`, c.id)
    }
  }
  const setupChildIds = new Map<string, string>()
  for (const { ref, id } of maps.categories) {
    const pk = `${ref.type}|${normKey(ref.parent)}`
    if (ref.child === null) {
      if (!topIds.has(pk)) topIds.set(pk, id)
    } else {
      setupChildIds.set(`${pk}|${normKey(ref.child)}`, id)
    }
  }
  const categoryIdOf = (ref: CategoryRef): string | undefined => {
    const pk = `${ref.type}|${normKey(ref.parent)}`
    const parentId = topIds.get(pk)
    if (ref.child === null) return parentId
    const ck = normKey(ref.child)
    return setupChildIds.get(`${pk}|${ck}`) ?? (parentId === undefined ? undefined : existingChildIds.get(`${parentId}|${ck}`))
  }

  let tagsDropped = 0
  const ops: BatchOp[] = operations.map((op) => {
    const where = `the operation at line ${op.lines.join(' and line ')}`
    const need = <T>(id: T | undefined, what: string): T => {
      if (id === undefined) throw new Error(`Finmap resolve: no ${what} id for ${where}`)
      return id
    }
    const accountOf = (name: string): string => need(own(maps.accounts, normKey(name)) ?? accountsOld.get(normKey(name)), 'account')

    const accountId = accountOf(op.account)
    const toAccountId = op.toAccount === null ? null : accountOf(op.toAccount)
    const categoryId = op.category === null ? null : need(categoryIdOf(op.category), 'category')
    const counterpartyId =
      op.counterparty === null ? null : need(own(maps.counterparties, normKey(op.counterparty)) ?? counterpartiesOld.get(normKey(op.counterparty)), 'counterparty')
    // Two names that are one tag by normKey give one id: the ledger refuses a repeated tag.
    const allTagIds = [...new Set(op.tags.map((tag) => need(own(maps.tags, normKey(tag)) ?? tagsOld.get(normKey(tag)), 'tag')))]
    const tagIds = allTagIds.slice(0, MAX_TX_TAGS)
    tagsDropped += allTagIds.length - tagIds.length
    return {
      kind: op.kind,
      status: op.status,
      day: op.day,
      amountMinor: op.amountMinor,
      accountId,
      toAccountId,
      toAmountMinor: op.toAmountMinor,
      categoryId,
      counterpartyId,
      tagIds,
      description: op.description,
      accrual: op.accrual,
      identity: op.identity,
      ordinal: op.ordinal,
    }
  })
  return { ops, tagsDropped }
}
