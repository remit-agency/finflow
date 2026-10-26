import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Shown in place of an owner-only settings page when another role opens its URL directly.
export function InsufficientRights() {
  const t = useTranslations('shell.insufficientRights')
  return (
    <Card data-testid="insufficient-rights" className="ring-line">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-ink-muted">{t('body')}</CardContent>
    </Card>
  )
}
