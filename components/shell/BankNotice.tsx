'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Landmark } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { mostUrgentNotice } from '@/lib/domain/banking/consent'
import { useBankStatus } from '@/lib/hooks/useBankStatus'
import { useShell } from '@/lib/hooks/useShell'
import { todayDay } from '@/lib/utils/today'

/** «Через N днів треба оновити банківське підключення»: for every member; the owner also gets the button. */
export function BankNotice() {
  const t = useTranslations('shell.bankNotice')
  const { orgId, can } = useShell()
  const { status } = useBankStatus(orgId)
  const connections = (status?.connections ?? []).map((c) => ({
    id: c.id,
    institutionName: c.institutionName,
    validUntilDay: todayDay(new Date(c.validUntil)),
    status: c.status,
  }))
  const urgent = mostUrgentNotice(connections, todayDay())
  if (!urgent) return null

  const { connection, notice } = urgent
  const message =
    notice.kind === 'expired' ? t('expired')
    : notice.kind === 'today' ? t('today')
    : notice.days === 1 ? t('tomorrow')
    : t('inDays', { days: notice.days })
  const owner = can('bank.manage')

  return (
    // The same inset card as the verification banner, in the warning tones.
    <div
      role="status"
      data-testid="bank-notice"
      className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:px-4 sm:py-3 lg:mx-8"
    >
      <Landmark className="size-4 shrink-0 text-amber-700" aria-hidden />
      <p className="min-w-0 flex-1">
        {connections.length > 1 ? t('withBank', { bank: connection.institutionName, message }) : message}
      </p>
      {owner ? (
        <Link
          data-testid="bank-notice-reconnect"
          href={`/${orgId}/settings/banks`}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0 border-amber-200 bg-surface text-amber-900 hover:bg-amber-100' })}
        >
          {t('reconnect')}
        </Link>
      ) : (
        <span className="shrink-0 text-amber-800">{t('askOwner')}</span>
      )}
    </div>
  )
}
