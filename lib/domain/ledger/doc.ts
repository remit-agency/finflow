import { isDay } from './days'
import { isMinor } from './money'
import {
  ACCOUNT_TYPES,
  TX_STATUSES,
  TX_TYPES,
  type Accrual,
  type Base,
  type BankInfo,
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
  if (tx.categoryId !== undefined) doc.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) doc.counterpartyId = tx.counterpartyId
  if (tx.description !== undefined) doc.description = tx.description
  if (tx.projectId !== undefined) doc.projectId = tx.projectId
  if (tx.fx !== undefined) doc.fx = tx.fx
  if (tx.base !== undefined) doc.base = tx.base
  if (tx.bank !== undefined) {
    doc.source = 'bank'
    const bank: Record<string, string> = { accountRef: tx.bank.accountRef }
    if (tx.bank.entryReference !== undefined) bank.entryReference = tx.bank.entryReference
    if (tx.bank.counterpartyName !== undefined) bank.counterpartyName = tx.bank.counterpartyName
    if (tx.bank.remittance !== undefined) bank.remittance = tx.bank.remittance
    doc.bank = bank
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
  } else {
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
  if (data.source === 'bank' && isRecord(data.bank) && typeof data.bank.accountRef === 'string') {
    const bank: BankInfo = { accountRef: data.bank.accountRef }
    for (const key of ['entryReference', 'counterpartyName', 'remittance'] as const) {
      const value = data.bank[key]
      if (typeof value === 'string') bank[key] = value
    }
    tx.bank = bank
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
