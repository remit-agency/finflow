'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { acceptLegalDocs, ConsentApiError } from '@/lib/api/consent-client'
import { useAuth } from '@/lib/hooks/useAuth'
import { useConsent } from '@/lib/hooks/useConsent'

type Failure = 'reload' | 'failed'

/**
 * Asks a signed-in person to accept the current Terms and Privacy Policy when the stored acceptance
 * is missing or for an older version. It cannot be dismissed: only accepting or signing out leaves it.
 * After a successful accept the live consent read flips the status to `ok` and the dialog closes by itself.
 * A failed consent read (`unknown`) never blocks, so an offline browser cannot lock a person out.
 */
export function ConsentGate() {
  const t = useTranslations('consent.gate')
  const { status } = useConsent()
  const { signOut } = useAuth()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  async function accept() {
    setPending(true)
    setFailure(null)
    try {
      await acceptLegalDocs('gate')
    } catch (e) {
      setFailure(e instanceof ConsentApiError && e.status === 409 ? 'reload' : 'failed')
    } finally {
      setPending(false)
    }
  }

  return (
    // The open state is controlled by the consent read alone: Esc and the backdrop ask to close, which is ignored.
    <Dialog open={status === 'needed'} onOpenChange={() => {}} disablePointerDismissal>
      <DialogContent showCloseButton={false} data-testid="consent-gate">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-3">
            {t('terms')}
          </a>
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-3">
            {t('privacy')}
          </a>
        </p>
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {t(failure)}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void signOut()} disabled={pending}>
            {t('signOut')}
          </Button>
          <Button type="button" onClick={() => void accept()} disabled={pending}>
            {pending ? t('accepting') : t('accept')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
