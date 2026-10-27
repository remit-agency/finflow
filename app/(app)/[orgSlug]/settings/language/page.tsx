'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'

export default function LanguageSettingsPage() {
  const t = useTranslations('common')
  return (
    <Card className="ring-line">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-ink">{t('language')}</CardTitle>
      </CardHeader>
      <CardContent>
        <LanguageSwitcher variant="list" />
      </CardContent>
    </Card>
  )
}
