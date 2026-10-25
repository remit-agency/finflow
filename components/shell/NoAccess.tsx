'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getMyOrganizations } from '@/lib/firebase/members'
import { useAuth } from '@/lib/hooks/useAuth'
import { useShell } from '@/lib/hooks/useShell'
import type { Organization } from '@/types'

// Shown instead of the whole shell when the URL's company is not the caller's ("denied": no
// membership) or when access could not be checked ("error"). Replaces the endless skeleton.
export function NoAccess({ variant }: { variant: 'denied' | 'error' }) {
  const t = useTranslations('shell.noAccess')
  const tErrors = useTranslations('errors')
  const { user, signOut } = useAuth()
  const { chooseOrg } = useShell()
  const [mine, setMine] = useState<Organization | null>(null)
  const uid = user?.uid

  useEffect(() => {
    if (!uid || variant !== 'denied') return
    let cancelled = false
    getMyOrganizations(uid).then(
      (orgs) => {
        if (!cancelled) setMine(orgs[0] ?? null)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [uid, variant])

  const denied = variant === 'denied'

  return (
    <div className="app-shell isolate flex min-h-dvh items-center justify-center bg-canvas p-6 text-ink">
      <div data-testid="no-access" className="w-full max-w-md rounded-panel border border-line bg-surface p-8 text-center shadow-panel">
        <h1 className="font-display text-xl font-semibold text-ink">
          {denied ? t('deniedTitle') : t('errorTitle')}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{denied ? t('deniedBody') : t('errorBody')}</p>
        <div className="mt-6 flex flex-col gap-2">
          {denied && mine && (
            <Button size="lg" onClick={() => chooseOrg(mine.id)}>
              {t('toMyCompany')}
            </Button>
          )}
          {!denied && (
            <Button size="lg" onClick={() => window.location.reload()}>
              {t('retry')}
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={() => signOut().catch(() => toast.error(tErrors('signOut')))}>
            {t('signOut')}
          </Button>
        </div>
      </div>
    </div>
  )
}
