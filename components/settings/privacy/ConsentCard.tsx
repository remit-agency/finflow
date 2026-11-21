'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsent } from '@/lib/hooks/useConsent'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { CONSENT_DOCS } from '@/lib/legal/versions'

/** The documents the signed-in person accepted: version and date from `userConsents/{uid}`. */
export function ConsentCard() {
  const t = useTranslations('privacy.consent')
  const tDoc = useTranslations('legal.links')
  const { status, state } = useConsent()
  const fmt = useFormatters()

  return (
    <Card className="ring-line" data-testid="consent-card">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {status === 'loading' ? null : status === 'unknown' ? (
          <p role="alert" className="text-sm text-ink-muted">
            {t('unavailable')}
          </p>
        ) : (
          <ul className="space-y-3">
            {CONSENT_DOCS.map((doc) => {
              const entry = state?.[doc]
              const at = entry ? new Date(entry.at) : null
              return (
                <li key={doc} className="flex flex-col gap-0.5 text-sm">
                  <Link href={`/legal/${doc}`} className="font-medium text-ink underline-offset-4 hover:underline">
                    {tDoc(doc)}
                  </Link>
                  <span className="text-ink-muted">
                    {entry && at && !Number.isNaN(at.getTime())
                      ? t('accepted', { version: entry.version, date: fmt.date(at) })
                      : t('notAccepted')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
