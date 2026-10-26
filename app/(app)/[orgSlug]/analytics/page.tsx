import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { BarChart2, TrendingUp, Calendar, BookOpen } from 'lucide-react'
import type { AnalyticsSection } from '@/lib/shell/analytics-sections'

interface Props {
  params: Promise<{ orgSlug: string }>
}

// The title of a card is the section's name (`shell.analyticsSections.<key>`), the description is
// `analytics.cards.<key>`.
const CARDS: ReadonlyArray<{ key: AnalyticsSection; icon: typeof BarChart2 }> = [
  { key: 'cashflow', icon: BarChart2 },
  { key: 'pl', icon: TrendingUp },
  { key: 'calendar', icon: Calendar },
  { key: 'balance', icon: BookOpen },
]

export default async function AnalyticsPage({ params }: Props) {
  const { orgSlug } = await params
  const t = await getTranslations('analytics')
  const tSections = await getTranslations('shell.analyticsSections')

  return (
    // The shared container and the reports' sub-navigation come from analytics/layout.tsx.
    <div>
      <div className="max-w-4xl space-y-8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">{t('title')}</h1>
          <p className="mt-1 text-ink-muted">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CARDS.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.key}
                href={`/${orgSlug}/analytics/${card.key}`}
                className="group rounded-panel border border-line bg-surface p-6 transition-all hover:border-brand hover:shadow-panel"
              >
                <div className="mb-4 flex size-12 items-center justify-center rounded-field bg-brand-soft">
                  <Icon className="size-6 text-brand-soft-foreground" />
                </div>
                <h2 className="text-lg font-semibold text-ink transition-colors group-hover:text-brand-soft-foreground">
                  {tSections(card.key)}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{t(`cards.${card.key}`)}</p>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
