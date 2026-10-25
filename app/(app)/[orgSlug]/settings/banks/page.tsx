'use client'

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import EnableBankingConnect from '@/components/settings/EnableBankingConnect'
import { RequireAction } from '@/components/shell/RequireAction'

// The Enable Banking callback returns here (`?eb_auth=` / `?eb_error=`). EnableBankingConnect
// (unchanged in S01A) consumes only `eb_auth`; a user who cancels at the bank lands here with
// `eb_error=1` and sees no message yet (known gap, tracked as a follow-up).
export default function BanksSettingsPage() {
  const t = useTranslations('settings.banks')
  const params = useParams()
  const orgId = params.orgSlug as string

  return (
    <RequireAction action="bank.manage">
      <Card className="ring-line">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
          <CardDescription className="text-ink-muted">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <EnableBankingConnect orgId={orgId} />
        </CardContent>
      </Card>
    </RequireAction>
  )
}
