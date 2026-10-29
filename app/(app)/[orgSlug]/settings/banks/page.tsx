'use client'

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import EnableBankingConnect from '@/components/settings/EnableBankingConnect'
import { RequireAction } from '@/components/shell/RequireAction'

// The Enable Banking callback returns here with `?eb_connected=1` or `?eb_error=1`; the connections
// and their linking are read from the server by EnableBankingConnect.
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
