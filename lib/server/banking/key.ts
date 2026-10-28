import { createHash } from 'node:crypto'
import type { EbTransaction } from '@/lib/domain/banking/map'

function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function sha(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0001')).digest('hex').slice(0, 32)
}

/**
 * The identity of each bank operation: 32 hex characters, stable between reads. With a bank reference
 * (`entry_reference`, else `transaction_id`) it is that reference inside the bank account. Without one it is a
 * fingerprint of day, amount, direction, other party and text, plus the ordinal among identical operations of the
 * same read (two identical coffees on one day stay two operations). The ordinal is per read: identical twins that
 * a bank splits across pages could be keyed differently (documented risk, S09 spec).
 */
export function bankTxKeys(bankAccountId: string, txs: EbTransaction[]): Array<{ key: string; tx: EbTransaction }> {
  const seen = new Map<string, number>()
  return txs.map((tx) => {
    const ref = (tx.entry_reference ?? tx.transaction_id ?? '').trim()
    if (ref !== '') return { key: sha([bankAccountId, 'ref', ref]), tx }
    const party = tx.credit_debit_indicator === 'DBIT' ? tx.creditor?.name : tx.debtor?.name
    const fingerprint = [
      bankAccountId,
      'fp',
      tx.booking_date ?? tx.value_date ?? tx.transaction_date ?? '',
      tx.transaction_amount?.amount ?? '',
      tx.transaction_amount?.currency ?? '',
      tx.credit_debit_indicator,
      norm(party),
      norm((tx.remittance_information ?? []).join(' ')),
    ]
    const id = fingerprint.join('\u0001')
    const ordinal = seen.get(id) ?? 0
    seen.set(id, ordinal + 1)
    return { key: sha([...fingerprint, String(ordinal)]), tx }
  })
}
