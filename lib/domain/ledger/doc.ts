import { isDay } from './days'
import { isId } from './guards'
import { isMinor } from './money'
import {
  ACCOUNT_TYPES,
  TX_STATUSES,
  TX_TYPES,
  type Accrual,
  type AutoRuleRef,
  type Base,
  type BankInfo,
  type BankToInfo,
  type Fx,
  type LedgerAccount,
  type LedgerTransaction,
  type RateEvidence,
} from './types'

export const SCHEMA_VERSION = 2

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null
}

function optionalString(v: unknown): string | undefined | null {
  if (v === undefined) return undefined
  return typeof v === 'string' ? v : null
}

function parseAccrual(v: unknown): Accrual | null {
  if (!isRecord(v)) return null
  if (v.mode === 'date' && isDay(v.date)) return { mode: 'date', date: v.date }
  if (v.mode === 'period' && isDay(v.from) && isDay(v.to)) return { mode: 'period', from: v.from, to: v.to }
  return null
}

function parseEvidence(v: unknown): RateEvidence | null {
  if (!isRecord(v)) return null
  const { rate, from, to, requestedDate, rateDate, tableNo, source } = v
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  if (typeof from !== 'string' || typeof to !== 'string') return null
  if (!isDay(requestedDate) || !isDay(rateDate)) return null
  if (tableNo !== null && typeof tableNo !== 'string') return null
  if (source !== 'NBP_A' && source !== 'identity') return null
  return { rate, from, to, requestedDate, rateDate, tableNo, source }
}

/** The rules that filled the operation. Only a trace: entries that are not `{ id, name }` strings are left out. */
function parseAutoRules(v: unknown): AutoRuleRef[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v
    .filter((r): r is AutoRuleRef => isRecord(r) && typeof r.id === 'string' && typeof r.name === 'string')
    .map((r) => ({ id: r.id, name: r.name }))
  return out.length > 0 ? out : undefined
}

/**
 * A bank block (`bank` of an operation, `bank` of a bank mark, `bankTo` without its key): `accountRef` and the optional
 * strings; null when it is not one. The one reader of that shape (S09, S10b).
 */
export function parseBankInfo(v: unknown): BankInfo | null {
  if (!isRecord(v) || typeof v.accountRef !== 'string') return null
  const bank: BankInfo = { accountRef: v.accountRef }
  for (const key of ['entryReference', 'counterpartyName', 'remittance'] as const) {
    const value = v[key]
    if (typeof value === 'string') bank[key] = value
  }
  return bank
}

function bankInfoToDoc(b: BankInfo): Record<string, string> {
  const doc: Record<string, string> = { accountRef: b.accountRef }
  if (b.entryReference !== undefined) doc.entryReference = b.entryReference
  if (b.counterpartyName !== undefined) doc.counterpartyName = b.counterpartyName
  if (b.remittance !== undefined) doc.remittance = b.remittance
  return doc
}

/** A stored `bankTo` (S10b): a bank block plus the key of the income it was; null when it is not one. */
function parseBankTo(v: unknown): BankToInfo | null {
  if (!isRecord(v) || !isId(v.key)) return null
  const bank = parseBankInfo(v)
  return bank === null ? null : { key: v.key, ...bank }
}

/** The stored fields of an operation (no id, no server timestamps). Never contains `undefined`. */
export function transactionToDoc(tx: LedgerTransaction): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    paymentDate: tx.paymentDate,
    accrual: tx.accrual,
    isRecurring: tx.isRecurring,
    tags: tx.tags,
    fileUrls: tx.fileUrls,
    schemaVersion: SCHEMA_VERSION,
  }
  if (tx.toAccountId !== undefined) doc.toAccountId = tx.toAccountId
  if (tx.toAmountMinor !== undefined) doc.toAmountMinor = tx.toAmountMinor
  if (tx.toCurrency !== undefined) doc.toCurrency = tx.toCurrency
  if (tx.toDate !== undefined) doc.toDate = tx.toDate
  if (tx.categoryId !== undefined) doc.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) doc.counterpartyId = tx.counterpartyId
  if (tx.description !== undefined) doc.description = tx.description
  if (tx.projectId !== undefined) doc.projectId = tx.projectId
  if (tx.fx !== undefined) doc.fx = tx.fx
  if (tx.base !== undefined) doc.base = tx.base
  if (tx.bank !== undefined) {
    doc.source = 'bank'
    doc.bank = bankInfoToDoc(tx.bank)
  }
  if (tx.bankTo !== undefined) doc.bankTo = { key: tx.bankTo.key, ...bankInfoToDoc(tx.bankTo) }
  if (tx.autoRules !== undefined && tx.autoRules.length > 0) doc.autoRules = tx.autoRules.map((r) => ({ id: r.id, name: r.name }))
  if (tx.excluded === true) doc.excluded = true
  if (tx.seriesId !== undefined && tx.occurrence !== undefined) {
    doc.seriesId = tx.seriesId
    doc.occurrence = tx.occurrence
    if (tx.estimated === true) doc.estimated = true
    if (tx.manual === true) doc.manual = true
  }
  return doc
}

/** A v2 operation document, or null when it is not one or is malformed (schema 1 documents are null). */
export function parseTransaction(id: string, data: unknown): LedgerTransaction | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION) return null
  const { type, status, accountId, amountMinor, currency, paymentDate, isRecurring } = data
  if (!(TX_TYPES as readonly unknown[]).includes(type) || !(TX_STATUSES as readonly unknown[]).includes(status)) return null
  if (typeof accountId !== 'string' || !isMinor(amountMinor) || amountMinor <= 0 || typeof currency !== 'string') return null
  if (!isDay(paymentDate) || typeof isRecurring !== 'boolean') return null
  const accrual = parseAccrual(data.accrual)
  const tags = stringArray(data.tags)
  const fileUrls = stringArray(data.fileUrls)
  if (!accrual || !tags || !fileUrls) return null

  const tx: LedgerTransaction = {
    id,
    type: type as LedgerTransaction['type'],
    status: status as LedgerTransaction['status'],
    accountId,
    amountMinor,
    currency,
    paymentDate,
    accrual,
    isRecurring,
    tags,
    fileUrls,
  }

  if (type === 'transfer') {
    if (typeof data.toAccountId !== 'string' || !isMinor(data.toAmountMinor) || data.toAmountMinor <= 0) return null
    if (typeof data.toCurrency !== 'string') return null
    tx.toAccountId = data.toAccountId
    tx.toAmountMinor = data.toAmountMinor
    tx.toCurrency = data.toCurrency
    // S10b: the arrival day and the incoming bank side. Malformed, they make the document unreadable (as `excluded` does).
    if (data.toDate !== undefined) {
      if (!isDay(data.toDate)) return null
      tx.toDate = data.toDate
    }
    if (data.bankTo !== undefined) {
      const bankTo = parseBankTo(data.bankTo)
      if (!bankTo) return null
      tx.bankTo = bankTo
    }
  } else {
    if (data.toDate !== undefined || data.bankTo !== undefined) return null
    const counterpartyId = optionalString(data.counterpartyId)
    if (counterpartyId === null) return null
    if (counterpartyId !== undefined) tx.counterpartyId = counterpartyId
  }

  for (const key of ['categoryId', 'description', 'projectId'] as const) {
    const value = optionalString(data[key])
    if (value === null) return null
    if (value !== undefined) tx[key] = value
  }

  if (data.fx !== undefined) {
    if (!isRecord(data.fx)) return null
    const fx: Fx = {}
    for (const key of ['payment', 'accrual'] as const) {
      if (data.fx[key] === undefined) continue
      const evidence = parseEvidence(data.fx[key])
      if (!evidence) return null
      fx[key] = evidence
    }
    tx.fx = fx
  }
  if (data.base !== undefined) {
    if (!isRecord(data.base) || !isMinor(data.base.payment) || !isMinor(data.base.accrual)) return null
    const base: Base = { payment: data.base.payment, accrual: data.base.accrual }
    tx.base = base
  }
  if (data.source === 'bank') {
    // A malformed bank block is left out rather than hiding the operation (S09).
    const bank = parseBankInfo(data.bank)
    if (bank) tx.bank = bank
  }
  const autoRules = parseAutoRules(data.autoRules)
  if (autoRules !== undefined) tx.autoRules = autoRules
  if (data.excluded !== undefined && typeof data.excluded !== 'boolean') return null
  if (data.excluded === true) tx.excluded = true
  // S11: the series link. Malformed, on a transfer, or a flag without the link: the document is unreadable (as `excluded`).
  if (data.seriesId !== undefined || data.occurrence !== undefined) {
    if (type === 'transfer' || !isId(data.seriesId) || !isDay(data.occurrence)) return null
    tx.seriesId = data.seriesId
    tx.occurrence = data.occurrence
  }
  for (const key of ['estimated', 'manual'] as const) {
    const value = data[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean' || tx.seriesId === undefined) return null
    if (value) tx[key] = true
  }
  return tx
}

export function accountToDoc(a: LedgerAccount): Record<string, unknown> {
  return {
    name: a.name,
    type: a.type,
    currency: a.currency,
    color: a.color,
    openingMinor: a.openingMinor,
    balanceMinor: a.balanceMinor,
    schemaVersion: SCHEMA_VERSION,
  }
}

/** A v2 account document, or null (legacy accounts, which have `balance` only, are null). */
export function parseAccount(id: string, data: unknown): LedgerAccount | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION) return null
  const { name, type, currency, color, openingMinor, balanceMinor } = data
  if (typeof name !== 'string' || typeof currency !== 'string' || typeof color !== 'string') return null
  if (!(ACCOUNT_TYPES as readonly unknown[]).includes(type)) return null
  if (!isMinor(openingMinor) || !isMinor(balanceMinor)) return null
  return { id, name, type: type as LedgerAccount['type'], currency, color, openingMinor, balanceMinor }
}
