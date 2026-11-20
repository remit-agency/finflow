'use client'

import { useTranslations } from 'next-intl'
import { NativeSelect } from '@/components/ui/native-select'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { LineIssueCode, OpStatus, RefusalReason } from '@/lib/domain/import/types'
import type { PreviewStatement } from '@/lib/domain/import/view'
import { useFormatters } from '@/lib/i18n/useFormatters'
import type { Account } from '@/types'

/** Operations listed under a statement; the rest is in the journal after the import. */
const SHOWN_OPS = 5

// Literal keys: the catalog is typed, so every key used here must exist in it.
export const REASON_KEY = {
  date: 'reason.date',
  future_date: 'reason.future_date',
  currency_mismatch: 'reason.currency_mismatch',
  amount: 'reason.amount',
} as const satisfies Record<RefusalReason, string>

// The parse issues of a statement's lines: a line that could not be read is listed, the rest of the statement is kept.
const ISSUE_KEY = {
  bad_61: 'issue.bad_61',
  bad_balance: 'issue.bad_balance',
  orphan_86: 'issue.orphan_86',
} as const satisfies Record<LineIssueCode, string>

const STATUS_KEY = {
  new: 'status.new',
  seen: 'status.seen',
  bank: 'status.bank',
} as const

interface Props {
  statement: PreviewStatement
  /** Position of the statement in the file (0-based). */
  position: number
  /** The company's accounts (the select lists them). */
  accounts: Account[]
  /** The chosen FinFlow account; null = skip this statement. */
  accountId: string | null
  disabled: boolean
  onChoose: (accountId: string | null) => void
}

/** One statement of the file: its facts, the balance check, the account choice and its first operations. */
export function StatementCard({ statement, position, accounts, accountId, disabled, onChoose }: Props) {
  const t = useTranslations('import')
  const { money, number, date } = useFormatters()

  const currency = statement.currency ?? statement.opening?.currency ?? null
  const account = accounts.find((a) => a.id === accountId) ?? null
  const mismatch = account !== null && statement.currency !== null && account.currency !== statement.currency

  // Amounts are minor units; the formatter takes the currency's major units (2 decimals in every supported currency).
  const amount = (minor: number): string => (currency ? money(fromMinor(minor), currency) : number(fromMinor(minor), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  const day = (value: string): string => date(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium' })

  // The accounts of the statement's currency first; the order of the company's accounts is kept within each group.
  const sorted = [...accounts].sort((a, b) => Number(b.currency === statement.currency) - Number(a.currency === statement.currency))

  const opStatus = (status: OpStatus | undefined): string => {
    if (status === undefined) return ''
    if (status === 'new' || status === 'seen' || status === 'bank') return t(STATUS_KEY[status])
    return t(REASON_KEY[status.slice('refused:'.length) as RefusalReason])
  }

  return (
    <section data-testid="import-preview" className="space-y-3 rounded-control border border-line p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-ink">{t('statement', { n: position + 1 })}</h3>
        {statement.source && <span className="min-w-0 break-all text-sm text-ink-muted">{statement.source}</span>}
      </header>

      <div className="space-y-1 text-sm text-ink">
        {statement.number && <p>{statement.number}</p>}
        <p>
          {t('period')}: {statement.from && statement.to ? `${day(statement.from)} – ${day(statement.to)}` : '–'}
        </p>
        {statement.opening && statement.closing && (
          <p className="tabular-nums">{t('balances', { opening: amount(statement.opening.amountMinor), closing: amount(statement.closing.amountMinor) })}</p>
        )}
        {statement.chosen && (
          <p className="tabular-nums">
            {t('counts', {
              new: statement.chosen.counts.new,
              seen: statement.chosen.counts.seen,
              bank: statement.chosen.counts.bank,
              refused: statement.chosen.counts.refused,
            })}
          </p>
        )}
      </div>

      {statement.reconciliation !== null && statement.reconciliation !== 0 && (
        <p role="status" className="rounded-[6px] bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">
          {t('noAdd', { diff: amount(statement.reconciliation) })}
        </p>
      )}
      {statement.issues.length > 0 && (
        <ul role="status" className="list-inside list-disc rounded-[6px] bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">
          {statement.issues.map((issue, i) => (
            <li key={i}>{t(ISSUE_KEY[issue.code], { line: issue.line })}</li>
          ))}
        </ul>
      )}
      {mismatch && account && statement.currency && (
        <p className="rounded-[6px] bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">
          {t('currencyMismatch', { statement: statement.currency, account: account.currency })}
        </p>
      )}

      <NativeSelect
        data-testid="import-account"
        aria-label={t('account')}
        value={accountId ?? ''}
        disabled={disabled}
        onChange={(e) => onChoose(e.target.value === '' ? null : e.target.value)}
        className="border-line"
      >
        <option value="">{t('skip')}</option>
        {sorted.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.currency})
          </option>
        ))}
      </NativeSelect>

      {statement.operations.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {statement.operations.slice(0, SHOWN_OPS).map((op, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
              <span className="tabular-nums text-ink-muted">{day(op.day)}</span>
              <span className="min-w-0 flex-1 truncate">{op.counterpartyName ?? op.remittance ?? ''}</span>
              <span className="tabular-nums">{amount(op.type === 'expense' ? -op.amountMinor : op.amountMinor)}</span>
              <span className="text-ink-muted">{opStatus(op.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
