'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BankPicker, type PickerInitial } from '@/components/settings/banks/BankPicker'
import { ConnectionCard } from '@/components/settings/banks/ConnectionCard'
import { LinkAccountDialog } from '@/components/settings/banks/LinkAccountDialog'
import { useBankStatus } from '@/lib/hooks/useBankStatus'
import { useShell } from '@/lib/hooks/useShell'

interface Props {
  orgId: string
}

/** The bank connections of the company and what is done with them. Owner only (the page requires `bank.manage`). */
export default function EnableBankingConnect({ orgId }: Props) {
  const t = useTranslations('settings.banks')
  const tErrors = useTranslations('errors.bank')
  const searchParams = useSearchParams()
  const { status, loading, error } = useBankStatus(orgId)
  const { accounts: finflowAccounts } = useShell()
  // The bank picker: closed (null), a new connection ({}), or a renewal of one bank (with its initial values).
  const [picker, setPicker] = useState<{ id: number; initial?: PickerInitial } | null>(null)
  // The connection whose accounts are being linked: its id, or 'newest' right after a bank login.
  const [linkFor, setLinkFor] = useState<string | 'newest' | null>(null)
  const handledReturn = useRef<string | null>(null)

  // The bank login returns here with `eb_connected=1` or `eb_error=1` (the server saved the session itself).
  useEffect(() => {
    const connected = searchParams.get('eb_connected')
    const failed = searchParams.get('eb_error')
    if (!connected && !failed) return
    const payload = `${connected ?? ''}|${failed ?? ''}`
    // Once per payload: a second effect run (Strict Mode, a re-render before the URL update lands) must not repeat it.
    if (handledReturn.current === payload) return
    handledReturn.current = payload
    const url = new URL(window.location.href)
    url.searchParams.delete('eb_connected')
    url.searchParams.delete('eb_error')
    window.history.replaceState({}, '', url.toString())
    // Deferred: on a fresh page load this effect runs before the root <Toaster> has subscribed, and sonner drops early toasts.
    setTimeout(() => {
      if (failed) {
        toast.error(tErrors('connectFailed'))
        return
      }
      toast.success(t('connectedNow'))
      setLinkFor('newest')
    }, 0)
  }, [searchParams, t, tErrors])

  const connections = status?.connections ?? []
  const accounts = status?.accounts ?? []
  // The server lists connections oldest first, so the last one is the newest.
  const linkConnection =
    linkFor === null ? null : linkFor === 'newest' ? (connections[connections.length - 1] ?? null) : (connections.find((c) => c.id === linkFor) ?? null)
  const linkedAccountIds = accounts.filter((a) => a.status === 'active').map((a) => a.accountId)

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {tErrors('loadStatus')}
        </p>
      )}
      {loading && status === null && !error && <p className="text-sm text-[#6b7280]">{t('loading')}</p>}

      {connections.map((c) => (
        <ConnectionCard
          key={c.id}
          orgId={orgId}
          connection={c}
          accounts={accounts.filter((a) => a.connectionId === c.id)}
          finflowAccounts={finflowAccounts}
          onRenew={() =>
            setPicker({
              id: Date.now(),
              initial: { name: c.institutionName, country: c.institutionCountry ?? 'PL', psuType: c.psuType ?? 'business' },
            })
          }
          onLink={() => setLinkFor(c.id)}
        />
      ))}

      <Button
        variant="outline"
        className="rounded-[8px] border-[#00c896] text-brand-soft-foreground hover:bg-[#00c896]/5"
        onClick={() => setPicker((p) => (p ? null : { id: Date.now() }))}
      >
        {picker ? <ChevronUp className="w-4 h-4 mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
        {t('connect')}
      </Button>

      {picker && (
        <BankPicker
          key={picker.id}
          orgId={orgId}
          initial={picker.initial}
          onCancel={() => setPicker(null)}
        />
      )}

      {linkConnection && (
        <LinkAccountDialog
          orgId={orgId}
          connection={linkConnection}
          finflowAccounts={finflowAccounts}
          linkedAccountIds={linkedAccountIds}
          open
          onOpenChange={(open) => {
            if (!open) setLinkFor(null)
          }}
        />
      )}
    </div>
  )
}
