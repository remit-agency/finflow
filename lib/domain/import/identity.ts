import type { ImportOp, RawOp } from './types'

function norm(s: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** What makes two lines "the same operation" of one account: day, amount, direction, then the reference or else the text. */
export function opIdentityParts(op: RawOp): string[] {
  const head = [op.day, String(op.amountMinor), op.type]
  return op.reference !== null ? [...head, 'ref', op.reference] : [...head, 'fp', norm(op.counterpartyName), norm(op.remittance)]
}

/** Numbers the lines that share an identity, in file order (0, 1, 2 …). The ordinal of each input line is replaced. */
export function withOrdinals(ops: readonly RawOp[]): ImportOp[] {
  const seen = new Map<string, number>()
  return ops.map((op) => {
    const id = opIdentityParts(op).join('\u0001')
    const ordinal = seen.get(id) ?? 0
    seen.set(id, ordinal + 1)
    return { ...op, ordinal }
  })
}

/** The lines of one statement and the account they go to (null: no account chosen, nothing is written). */
export interface AccountLines {
  accountId: string | null
  ops: readonly ImportOp[]
}

/**
 * The ordinal of every line, numbered over all the statements of a file that go to one account, in file order: identical
 * lines of two statements of one account are two operations (0 and 1), while the same line for two accounts stays 0.
 * A line without an account keeps its ordinal. Both the preview and the run number the lines with this, so they agree.
 */
export function ordinalsByAccount(groups: readonly AccountLines[]): number[][] {
  const out: number[][] = groups.map((group) => group.ops.map((op) => op.ordinal))
  const byAccount = new Map<string, number[]>()
  groups.forEach((group, i) => {
    if (group.accountId !== null) byAccount.set(group.accountId, [...(byAccount.get(group.accountId) ?? []), i])
  })
  for (const members of byAccount.values()) {
    const numbered = withOrdinals(members.flatMap((i) => groups[i].ops))
    let at = 0
    for (const i of members) {
      const count = groups[i].ops.length
      out[i] = numbered.slice(at, at + count).map((op) => op.ordinal)
      at += count
    }
  }
  return out
}
