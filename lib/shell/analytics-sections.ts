// Analytics reports (S01A): the pill sub-navigation of the Analytics module. Pure, unit-tested.

export type AnalyticsSection = 'cashflow' | 'pl' | 'balance' | 'calendar'

// The label of a section is `t('shell.analyticsSections.<slug>')`.
export const ANALYTICS_SECTIONS: ReadonlyArray<{ slug: AnalyticsSection }> = [
  { slug: 'cashflow' },
  { slug: 'pl' },
  { slug: 'balance' },
  { slug: 'calendar' },
]

export function analyticsPath(orgId: string, section: AnalyticsSection): string {
  return `/${encodeURIComponent(orgId)}/analytics/${section}`
}

/** The report a pathname belongs to (`/<org>/analytics/<section>/...`), or null (the index too). */
export function activeAnalyticsSection(pathname: string, orgId: string): AnalyticsSection | null {
  const prefix = `/${encodeURIComponent(orgId)}/analytics/`
  if (!pathname.startsWith(prefix)) return null
  const slug = pathname.slice(prefix.length).split('/')[0]
  return ANALYTICS_SECTIONS.find((s) => s.slug === slug)?.slug ?? null
}
