'use client'

import { useTranslations } from 'next-intl'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { CashFlowReport } from '@/lib/domain/reports/types'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { inShellOrder } from '@/lib/utils/report-view'

/** «За рахунками» of Cash Flow (S12): every chosen account in its own currency, from its opening to its closing balance. */
export function CashFlowAccounts({ report }: { report: CashFlowReport }) {
  const t = useTranslations('reports.byAccount')
  const { accounts } = useShell()
  const { money } = useFormatters()
  const names = new Map(accounts.map((a) => [a.id, a.name]))
  const balances = new Map(report.reconciliation.accounts.map((a) => [a.accountId, a]))
  return (
    <section aria-labelledby="cf-accounts-title" className="overflow-hidden rounded-panel border border-line bg-surface">
      <h2 id="cf-accounts-title" className="border-b border-line px-6 py-4 text-sm font-semibold text-ink">{t('title')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="bg-canvas text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-6 py-3 text-left font-semibold">{t('account')}</th>
              <th className="px-4 py-3 text-right font-semibold">{t('opening')}</th>
              <th className="px-4 py-3 text-right font-semibold">{t('income')}</th>
              <th className="px-4 py-3 text-right font-semibold">{t('expense')}</th>
              <th className="px-4 py-3 text-right font-semibold">{t('transfers')}</th>
              <th className="px-6 py-3 text-right font-semibold">{t('closing')}</th>
            </tr>
          </thead>
          <tbody>
            {inShellOrder(report.accounts, accounts).map((line) => {
              const balance = balances.get(line.accountId)
              const currency = balance?.currency ?? report.currency
              const m = (minor: number) => money(fromMinor(minor), currency)
              return (
                <tr key={line.accountId} data-testid="cf-account-row" className="border-t border-line">
                  <td className="whitespace-nowrap px-6 py-3 font-medium text-ink">{names.get(line.accountId) ?? line.accountId}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-ink">{balance ? m(balance.openingMinor) : '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-income">{m(line.inMinor)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-expense">{m(line.outMinor)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-ink-muted">{m(line.transferInMinor - line.transferOutMinor)}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-right font-semibold text-ink">{balance ? m(balance.closingMinor) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
