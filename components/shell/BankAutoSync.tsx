'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { syncBankAccount } from '@/lib/api/bank-client'
import { useBankStatus } from '@/lib/hooks/useBankStatus'
import { useShell } from '@/lib/hooks/useShell'

const STALE_MS = 60 * 60 * 1000

/**
 * Owner only: when the app opens, syncs every linked bank account whose last sync is older than an hour
 * (or never happened). Once per account per page load. A failure is silent: the expiry banner and the
 * settings page show what is wrong; the button there retries with a message.
 */
export function BankAutoSync() {
  const t = useTranslations('shell.bankSync')
  const { orgId, can } = useShell()
  const owner = can('bank.manage')
  const { status, refresh } = useBankStatus(orgId, owner)
  const attempted = useRef(new Set<string>())

  useEffect(() => {
    if (!owner || !status?.accounts) return
    const live = new Set(status.connections.filter((c) => c.status === 'active').map((c) => c.id))
    const due = status.accounts.filter(
      (a) => a.status === 'active' && live.has(a.connectionId) && !attempted.current.has(a.id) &&
        (a.lastSyncAt === null || Date.now() - Date.parse(a.lastSyncAt) > STALE_MS),
    )
    if (due.length === 0) return
    for (const a of due) attempted.current.add(a.id)
    // Not cancelled on cleanup: React Strict Mode runs the effect twice in development and the second run would
    // find the accounts already marked as attempted. A sync that outlives the page is harmless (the server locks).
    void (async () => {
      let imported = 0
      for (const a of due) {
        try {
          imported += (await syncBankAccount(orgId, a.id)).imported
        } catch {
          // See the component comment.
        }
      }
      if (imported > 0) toast.success(t('autoSynced', { count: imported }))
      refresh()
    })()
  }, [owner, status, orgId, refresh, t])

  return null
}
