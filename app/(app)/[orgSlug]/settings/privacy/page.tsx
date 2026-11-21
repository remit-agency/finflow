'use client'

import { useTranslations } from 'next-intl'
import { ConsentCard } from '@/components/settings/privacy/ConsentCard'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { OPERATOR } from '@/content/legal/operator'

export default function PrivacySettingsPage() {
  const t = useTranslations('privacy.page')
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-ink">{t('title')}</h2>
        <p className="text-sm text-ink-muted">{t('intro')}</p>
      </div>
      <ConsentCard />
      <LegalLinks />
      {OPERATOR.rodoEmail ? <p className="text-sm text-ink-muted">{t('dataRights', { email: OPERATOR.rodoEmail })}</p> : null}
    </div>
  )
}
