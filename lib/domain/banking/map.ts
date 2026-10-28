import { isDay } from '@/lib/domain/ledger/days'
import type { BankInfo } from '@/lib/domain/ledger/types'

/** One operation as Enable Banking returns it (only the fields S09 reads). */
export interface EbTransaction {
  entry_reference?: string | null
  transaction_id?: string | null
  booking_date?: string | null
  value_date?: string | null
  transaction_date?: string | null
  transaction_amount: { amount: string; currency: string }
  credit_debit_indicator: 'CRDT' | 'DBIT'
  status?: string | null
  creditor?: { name?: string | null } | null
  debtor?: { name?: string | null } | null
  remittance_information?: string[] | null
  note?: string | null
}

export interface EbBalance {
  balance_type: string
  balance_amount: { amount: string; currency: string }
  credit_debit_indicator?: 'CRDT' | 'DBIT' | null
}

export interface MapContext {
  bankAccountId: string
  accountId: string
  accountCurrency: string
  /** The deterministic operation id (`bk_` + key). */
  clientId: string
}

export type MapResult =
  | { ok: true; input: Record<string, unknown>; bank: BankInfo }
  | { ok: false; reason: 'status' | 'currency' | 'amount' | 'date' }

/** "123.45" -> 12345. Exactly the shapes banks send for 2-decimal currencies; anything else is null. */
export function parseDecimalMinor(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s.trim())
  if (!m) return null
  const minor = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  if (minor === 0) return 0
  return m[1] === '-' ? -minor : minor
}

function clean(text: string | null | undefined, max: number): string | undefined {
  if (typeof text !== 'string') return undefined
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length === 0 ? undefined : t.slice(0, max)
}

/** Turns a booked bank operation into the input of `parseTransactionInput` plus the provenance block. */
export function mapBankTransaction(raw: EbTransaction, ctx: MapContext): MapResult {
  if (raw.status !== undefined && raw.status !== null && raw.status !== 'BOOK') return { ok: false, reason: 'status' }
  if (raw.transaction_amount?.currency !== ctx.accountCurrency) return { ok: false, reason: 'currency' }
  const signed = parseDecimalMinor(raw.transaction_amount?.amount)
  const amountMinor = signed === null ? 0 : Math.abs(signed)
  if (amountMinor === 0) return { ok: false, reason: 'amount' }
  const paymentDate = [raw.booking_date, raw.value_date, raw.transaction_date].find((d) => isDay(d))
  if (paymentDate === undefined) return { ok: false, reason: 'date' }

  const debit = raw.credit_debit_indicator === 'DBIT'
  const remittance = clean((raw.remittance_information ?? []).join(' '), 500)
  const description = remittance ?? clean(raw.note, 500)
  const counterpartyName = clean(debit ? raw.creditor?.name : raw.debtor?.name, 200)
  const entryReference = clean(raw.entry_reference ?? raw.transaction_id, 200)

  const input: Record<string, unknown> = {
    clientId: ctx.clientId,
    type: debit ? 'expense' : 'income',
    status: 'actual',
    accountId: ctx.accountId,
    amountMinor,
    paymentDate,
  }
  if (description !== undefined) input.description = description

  const bank: BankInfo = { accountRef: ctx.bankAccountId }
  if (entryReference !== undefined) bank.entryReference = entryReference
  if (counterpartyName !== undefined) bank.counterpartyName = counterpartyName
  if (remittance !== undefined) bank.remittance = remittance
  return { ok: true, input, bank }
}

const BALANCE_ORDER = ['CLBD', 'ITBD', 'XPCD', 'OPBD', 'VALU']

/** The booked balance to compare with the ledger: closing booked first, then interim booked, then any. */
export function pickBalance(balances: EbBalance[], currency: string): { amountMinor: number; type: string } | null {
  const usable = balances.filter((b) => b.balance_amount?.currency === currency && parseDecimalMinor(b.balance_amount.amount) !== null)
  if (usable.length === 0) return null
  const rank = (t: string) => {
    const i = BALANCE_ORDER.indexOf(t)
    return i === -1 ? BALANCE_ORDER.length : i
  }
  const best = [...usable].sort((a, b) => rank(a.balance_type) - rank(b.balance_type))[0]
  const magnitude = parseDecimalMinor(best.balance_amount.amount) as number
  const amountMinor = best.credit_debit_indicator === 'DBIT' ? -Math.abs(magnitude) : magnitude
  return { amountMinor, type: best.balance_type }
}
