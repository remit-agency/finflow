import type { ImportOp, RawOp } from './types'

function norm(s: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** What makes two lines "the same operation" of one account: day, amount, direction, then the reference or else the text. */
export function opIdentityParts(op: RawOp): string[] {
  const head = [op.day, String(op.amountMinor), op.type]
  return op.reference !== null ? [...head, 'ref', op.reference] : [...head, 'fp', norm(op.counterpartyName), norm(op.remittance)]
}

/** Numbers the lines that share an identity, in file order (0, 1, 2 …). */
export function withOrdinals(ops: readonly RawOp[]): ImportOp[] {
  const seen = new Map<string, number>()
  return ops.map((op) => {
    const id = opIdentityParts(op).join('\u0001')
    const ordinal = seen.get(id) ?? 0
    seen.set(id, ordinal + 1)
    return { ...op, ordinal }
  })
}
