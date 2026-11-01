'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { convertTargets } from '@/lib/domain/transfers/targets'
import type { Account } from '@/types'

interface Props {
  /** The bank account every selected operation belongs to. */
  source: Account
  accounts: Account[]
  /** The accounts a bank is linked to, or null when the browser cannot see the links (then every account is offered). */
  linked: ReadonlySet<string> | null
  count: number
  busy: boolean
  onApply: (toAccountId: string) => void
  onClose: () => void
}

/**
 * «Зробити переказом» (S10b): the account of the other side (a cash box, a manual account) in the currency of the bank
 * account. An account a bank is linked to is not offered when the links are known: the server refuses it (`not_eligible`),
 * and two bank operations are merged instead.
 */
export function ConvertTransferDialog({ source, accounts, linked, count, busy, onApply, onClose }: Props) {
  const t = useTranslations('journal.transfers')
  const targets = convertTargets(accounts, source, linked)
  const [target, setTarget] = useState('')

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('convertTitle')}</DialogTitle>
          <DialogDescription>{t('convertBody', { count, account: source.name, currency: source.currency })}</DialogDescription>
        </DialogHeader>

        {targets.length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="transfer-target">{t('convertTarget')}</Label>
            <NativeSelect id="transfer-target" wrapperClassName="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('convertChoose')}</option>
              {targets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('convertNoTarget', { currency: source.currency })}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('convertCancel')}
          </Button>
          <Button type="button" disabled={busy || target === ''} onClick={() => onApply(target)}>
            {t('convertApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
