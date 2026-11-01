import { asRecord, bad, isId, onlyKeys } from '@/lib/domain/ledger/guards'
import { MAX_CONVERT_IDS, MAX_SUGGESTIONS, type TransferRequest } from './types'
import { parseVersion } from './version'

/** `min`..`max` safe document ids, none twice. */
function distinctIds(v: unknown, field: string, min: number, max: number): string[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) bad(field)
  if (!v.every((id) => isId(id)) || new Set(v).size !== v.length) bad(field)
  return [...(v as string[])]
}

/**
 * A body of `POST /transfers` (S10b): exactly one of `pairs` (suggested pairs with the versions the person saw), `merge`
 * (two operations in any order) and `convert` (operations of one bank account and the account of the other side).
 * Anything else, an unusable id included, is `invalid_input` with the field.
 */
export function parseTransferRequest(body: unknown): TransferRequest {
  const r = asRecord(body)
  onlyKeys(r, ['pairs', 'merge', 'convert'])
  if (Object.keys(r).length !== 1) bad('body')
  if (r.pairs !== undefined) {
    if (!Array.isArray(r.pairs) || r.pairs.length === 0 || r.pairs.length > MAX_SUGGESTIONS) bad('pairs')
    const pairs = r.pairs.map((raw: unknown, i: number) => {
      const p = asRecord(raw, `pairs.${i}`)
      onlyKeys(p, ['fromId', 'toId', 'versions'], `pairs.${i}.`)
      const [fromId, toId] = distinctIds([p.fromId, p.toId], `pairs.${i}`, 2, 2)
      const versions = p.versions
      if (!Array.isArray(versions) || versions.length !== 2 || !versions.every((v) => parseVersion(v) !== null)) bad(`pairs.${i}.versions`)
      return { ids: [fromId, toId] as [string, string], versions: [versions[0], versions[1]] as [string, string] }
    })
    // One operation goes into one transfer: an id in two pairs is refused.
    distinctIds(pairs.flatMap((p) => p.ids), 'pairs', 2, 2 * MAX_SUGGESTIONS)
    return { kind: 'pairs', pairs }
  }
  if (r.merge !== undefined) {
    const [a, b] = distinctIds(r.merge, 'merge', 2, 2)
    return { kind: 'merge', ids: [a, b] }
  }
  const c = asRecord(r.convert, 'convert')
  onlyKeys(c, ['ids', 'toAccountId'], 'convert.')
  const ids = distinctIds(c.ids, 'convert.ids', 1, MAX_CONVERT_IDS)
  if (!isId(c.toAccountId)) bad('convert.toAccountId')
  return { kind: 'convert', ids, toAccountId: c.toAccountId }
}
