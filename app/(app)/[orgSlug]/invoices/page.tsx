'use client'

import { useTranslations } from 'next-intl'

// «Faktury»: the module arrives with S19/S20; until then the tab opens this page, so the whole menu is visible.
export default function InvoicesPage() {
  const t = useTranslations('invoices')
  return (
    <div className="px-4 py-6 lg:px-8">
      <h1 className="font-display text-xl font-semibold text-ink">{t('title')}</h1>
      <p data-testid="invoices-soon" className="mt-2 text-sm text-ink-muted">
        {t('soon')}
      </p>
    </div>
  )
}
