// Pure planner for the schema 1 -> schema 2 ledger migration (S05). No I/O, no Firebase: unit-tested in Vitest.
import { fxPlan, type FxRequest } from '@/lib/domain/ledger/build'
import { isDay, toDay } from '@/lib/domain/ledger/days'
import { accountToDoc } from '@/lib/domain/ledger/doc'
import { balanceEffects } from '@/lib/domain/ledger/effects'
import { toMinor } from '@/lib/domain/ledger/money'
import { ACCOUNT_TYPES, LEDGER_CURRENCIES, TX_TYPES, type LedgerAccount, type LedgerTransaction } from '@/lib/domain/ledger/types'

export interface LegacyDoc {
  id: string
  /** `date` must already be a Date (the caller converts the Firestore Timestamp). */
  data: Record<string, unknown>
}

export interface PlanInput {
  baseCurrency: string
  /** The Warsaw day. */
  today: string
  /** Account documents that are not schema 2 yet. */
  legacyAccounts: LegacyDoc[]
  /** Accounts already schema 2: id -> currency. */
  migratedAccounts: ReadonlyMap<string, string>
  /** Operation documents that are not schema 2 yet. */
  legacyTxs: LegacyDoc[]
  /** Operations a previous run migrated (marker `migratedFrom: 'v1'`); they still count for a legacy account's opening balance. */
  markedTxs: LedgerTransaction[]
  /** Accounts whose opening balance is forced to 0 (balance becomes the sum of operations). */
  resetOpening: ReadonlySet<string>
}

export interface PlannedAccount {
  id: string
  fields: Record<string, unknown>
  legacyBalanceMinor: number
  sumMinor: number
  openingMinor: number
  balanceMinor: number
}

export interface PlannedTx {
  id: string
  tx: LedgerTransaction
  /** Set when the legacy `currency` differed from the account's; kept as `legacy.currency`. */
  legacyCurrency?: string
  fxRequests: FxRequest[]
}

export interface Plan {
  accounts: PlannedAccount[]
  txs: PlannedTx[]
  skipped: Array<{ kind: 'account' | 'tx'; id: string; reason: string }>
  counters: { currencyMismatch: number; transferAmountAssumed: number; futureActual: number }
}

const HEX = /^#[0-9a-fA-F]{6}$/
const DEFAULT_COLOR = '#00c896'

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function planOrg(input: PlanInput): Plan {
  const skipped: Plan['skipped'] = []
  const counters = { currencyMismatch: 0, transferAmountAssumed: 0, futureActual: 0 }
  const known = new Map<string, string>(input.migratedAccounts)

  const legacy: Array<{ id: string; account: LedgerAccount; legacyBalanceMinor: number }> = []
  for (const { id, data } of input.legacyAccounts) {
    const name = str(data.name)?.trim()
    const currency = data.currency
    const balance = data.balance
    if (!name) { skipped.push({ kind: 'account', id, reason: 'invalid_name' }); continue }
    if (!(LEDGER_CURRENCIES as readonly unknown[]).includes(currency)) { skipped.push({ kind: 'account', id, reason: 'invalid_currency' }); continue }
    if (typeof balance !== 'number' || !Number.isFinite(balance) || Math.abs(balance) > 1e11) { skipped.push({ kind: 'account', id, reason: 'invalid_balance' }); continue }
    const type = (ACCOUNT_TYPES as readonly unknown[]).includes(data.type) ? (data.type as LedgerAccount['type']) : 'bank'
    const color = typeof data.color === 'string' && HEX.test(data.color) ? data.color : DEFAULT_COLOR
    const legacyBalanceMinor = toMinor(balance)
    known.set(id, currency as string)
    legacy.push({
      id,
      legacyBalanceMinor,
      account: { id, name, type, currency: currency as string, color, openingMinor: 0, balanceMinor: legacyBalanceMinor },
    })
  }

  const txs: PlannedTx[] = []
  for (const { id, data } of input.legacyTxs) {
    const type = data.type
    const accountId = str(data.accountId)
    const amount = data.amount
    const date = data.date
    if (!(TX_TYPES as readonly unknown[]).includes(type)) { skipped.push({ kind: 'tx', id, reason: 'invalid_type' }); continue }
    if (!accountId || !known.has(accountId)) { skipped.push({ kind: 'tx', id, reason: 'unknown_account' }); continue }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e11) { skipped.push({ kind: 'tx', id, reason: 'invalid_amount' }); continue }
    const amountMinor = toMinor(amount)
    if (amountMinor < 1) { skipped.push({ kind: 'tx', id, reason: 'invalid_amount' }); continue }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) { skipped.push({ kind: 'tx', id, reason: 'invalid_date' }); continue }
    const paymentDate = toDay(date)
    if (!isDay(paymentDate) || paymentDate < '2000-01-01') { skipped.push({ kind: 'tx', id, reason: 'invalid_date' }); continue }

    const currency = known.get(accountId) as string
    const tx: LedgerTransaction = {
      id,
      type: type as LedgerTransaction['type'],
      status: 'actual',
      accountId,
      amountMinor,
      currency,
      paymentDate,
      accrual: { mode: 'date', date: paymentDate },
      isRecurring: data.isRecurring === true,
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [],
      fileUrls: Array.isArray(data.fileUrls) ? data.fileUrls.filter((u): u is string => typeof u === 'string') : [],
    }
    const planned: PlannedTx = { id, tx, fxRequests: [] }

    if (type === 'transfer') {
      const to = str(data.counterpartyId)
      if (!to || !known.has(to)) { skipped.push({ kind: 'tx', id, reason: 'unknown_target' }); continue }
      if (to === accountId) { skipped.push({ kind: 'tx', id, reason: 'same_account' }); continue }
      tx.toAccountId = to
      tx.toCurrency = known.get(to) as string
      tx.toAmountMinor = amountMinor
      if (tx.toCurrency !== currency) counters.transferAmountAssumed++
    } else {
      const categoryId = str(data.categoryId)
      if (categoryId) tx.categoryId = categoryId
      const counterpartyId = str(data.counterpartyId)
      if (counterpartyId) tx.counterpartyId = counterpartyId
    }
    const description = str(data.description)
    if (description) tx.description = description
    const projectId = str(data.projectId)
    if (projectId) tx.projectId = projectId

    if (typeof data.currency === 'string' && data.currency !== currency) {
      planned.legacyCurrency = data.currency
      counters.currencyMismatch++
    }
    if (paymentDate > input.today) counters.futureActual++
    planned.fxRequests = fxPlan(tx, input.baseCurrency, input.today)
    txs.push(planned)
  }

  // Opening balance of a legacy account = legacy balance - sum of the effects of all its operations
  // (the ones being migrated now and the ones a previous run migrated).
  const sums = new Map<string, number>()
  for (const t of [...txs.map((p) => p.tx), ...input.markedTxs]) {
    for (const [accountId, delta] of Object.entries(balanceEffects(t))) sums.set(accountId, (sums.get(accountId) ?? 0) + delta)
  }
  const accounts: PlannedAccount[] = legacy.map(({ id, account, legacyBalanceMinor }) => {
    const sumMinor = sums.get(id) ?? 0
    const reset = input.resetOpening.has(id)
    const openingMinor = reset ? 0 : legacyBalanceMinor - sumMinor
    const balanceMinor = reset ? sumMinor : legacyBalanceMinor
    const final: LedgerAccount = { ...account, openingMinor, balanceMinor }
    return { id, fields: accountToDoc(final), legacyBalanceMinor, sumMinor, openingMinor, balanceMinor }
  })

  return { accounts, txs, skipped, counters }
}
