'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Building2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { syncBankAccount, disconnectBank } from '@/lib/api/bank-client'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { bankErrorKey } from '@/lib/enablebanking/errors'
import { consentNotice, type ConsentNotice } from '@/lib/domain/banking/consent'
import type { BankAccountStatus, BankConnectionStatus } from '@/lib/domain/banking/status-types'
import { toMinor, fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { todayDay } from '@/lib/utils/today'
import type { Account } from '@/types'

interface Props {
  orgId: string
  connection: BankConnectionStatus
  /** The bank accounts of this connection that are linked to FinFlow accounts. */
  accounts: BankAccountStatus[]
  finflowAccounts: Account[]
  onRenew: () => void
  onLink: () => void
}

const WARSAW = 'Europe/Warsaw'

/** One connection of the bank: its access, its accounts and what can be done with them (owner only). */
export function ConnectionCard({ orgId, connection, accounts, finflowAccounts, onRenew, onLink }: Props) {
  const t = useTranslations('settings.banks')
  const tNotice = useTranslations('shell.bankNotice')
  const tErrors = useTranslations('errors.bank')
  const { date, money } = useFormatters()
  // null while no sync runs; otherwise how many operations this run has added so far.
  const [running, setRunning] = useState<number | null>(null)

  const expired = connection.status === 'expired'
  const notice: ConsentNotice = expired ? { kind: 'expired' } : consentNotice(todayDay(new Date(connection.validUntil)), todayDay())
  const noticeText =
    notice.kind === 'none' ? null
    : notice.kind === 'expired' ? tNotice('expired')
    : notice.kind === 'today' ? tNotice('today')
    : notice.days === 1 ? tNotice('tomorrow')
    : tNotice('inDays', { days: notice.days })
  const urgent = notice.kind !== 'none'
  const activeAccounts = accounts.filter((a) => a.status === 'active')

  const run = async () => {
    setRunning(0)
    let imported = 0
    try {
      for (const a of activeAccounts) {
        const totals = await syncBankAccount(orgId, a.id, { onProgress: (p) => setRunning(imported + p.imported) })
        imported += totals.imported
        if (totals.busy) toast.info(t('sync.busy'))
      }
      toast.success(imported > 0 ? t('sync.imported', { count: imported }) : t('sync.upToDate'))
    } catch (e) {
      console.error('Bank sync failed', e instanceof LedgerApiError ? e.code : e)
      toast.error(tErrors(bankErrorKey(e instanceof LedgerApiError ? e.code : '')))
    } finally {
      setRunning(null)
    }
  }

  const disconnect = async () => {
    try {
      await disconnectBank(orgId, connection.id)
      toast.success(t('disconnected'))
    } catch {
      toast.error(tErrors('disconnectFailed'))
    }
  }

  return (
    <div className="space-y-3 rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="w-5 h-5 text-[#6b7280]" aria-hidden />
          <div>
            <p className="text-sm font-medium text-[#111111]">{connection.institutionName}</p>
            <p className="text-xs text-[#6b7280]">
              {t('validUntil', { date: date(new Date(connection.validUntil), { dateStyle: 'medium', timeZone: WARSAW }) })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="bank-status"
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${expired ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}
          >
            {expired ? t('status.expired') : t('status.active')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 text-red-500 hover:text-red-600"
            aria-label={t('disconnect', { name: connection.institutionName })}
            onClick={disconnect}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {noticeText && (
        <p className="rounded-[6px] bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">{noticeText}</p>
      )}

      {activeAccounts.length > 0 && (
        <ul className="space-y-2">
          {activeAccounts.map((a) => {
            const linked = finflowAccounts.find((f) => f.id === a.accountId)
            const difference = linked && a.bankBalanceMinor !== null ? toMinor(linked.balance) - a.bankBalanceMinor : null
            return (
              <li key={a.id} className="rounded-[6px] border border-[#e5e7eb] bg-white p-2.5 text-sm">
                <p className="font-medium text-[#111111]">
                  {a.ibanTail ? t('accounts.iban', { tail: a.ibanTail }) : t('accounts.noIban')} · {a.currency}
                </p>
                <p className="text-xs text-[#6b7280]">
                  {linked ? t('accounts.linkedTo', { name: linked.name }) : t('accounts.notLinked')}
                </p>
                <p className="text-xs text-[#6b7280]">
                  {a.lastSyncAt
                    ? t('accounts.lastSync', { date: date(new Date(a.lastSyncAt), { dateStyle: 'medium', timeStyle: 'short', timeZone: WARSAW }) })
                    : t('accounts.neverSynced')}
                </p>
                {a.bankBalanceMinor !== null && (
                  <div className="mt-1 space-y-0.5 text-xs text-[#111111]">
                    <p>
                      {t('accounts.bankBalance')}: {money(fromMinor(a.bankBalanceMinor), a.currency)}
                    </p>
                    {difference !== null && (
                      difference === 0 ? (
                        <p className="text-emerald-700">{t('accounts.matches')}</p>
                      ) : (
                        <p className="text-amber-800">
                          {t('accounts.difference')}: {money(fromMinor(difference), a.currency)}
                        </p>
                      )
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="bank-sync"
          variant="outline"
          size="sm"
          disabled={running !== null || activeAccounts.length === 0}
          onClick={run}
        >
          {running === null ? t('sync.refresh') : `${t('sync.running')}${running > 0 ? ` (${running})` : ''}`}
        </Button>
        <Button variant={urgent || expired ? 'default' : 'outline'} size="sm" onClick={onRenew}>
          {t('renew')}
        </Button>
        <Button data-testid="bank-link-open" variant="outline" size="sm" disabled={expired} onClick={onLink}>
          {t('link.open')}
        </Button>
      </div>
    </div>
  )
}
