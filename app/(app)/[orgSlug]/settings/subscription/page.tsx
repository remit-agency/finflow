'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RequireAction } from '@/components/shell/RequireAction'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'

export default function SubscriptionSettingsPage() {
  const t = useTranslations('settings.subscription')
  const { date } = useFormatters()
  // The shell's org is always the URL's org (null while it loads).
  const { org } = useShell()

  return (
    <RequireAction action="subscription.view">
      <Card className="ring-line">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!org ? (
            <div className="h-10 animate-pulse rounded-control bg-canvas" />
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium capitalize text-ink">{t(`plans.${org.plan}`)}</p>
                {org.plan === 'trial' && (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {/* trialEndsAt is an instant: shown as the Warsaw calendar day, in the numeric form of the UI language. */}
                    {t('trialUntil', {
                      date: date(org.trialEndsAt, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Warsaw' }),
                    })}
                  </p>
                )}
              </div>
              {org.plan !== 'pro' && (
                <Button variant="outline" className="border-brand text-brand-soft-foreground hover:bg-brand-soft">
                  {t('upgrade')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </RequireAction>
  )
}
