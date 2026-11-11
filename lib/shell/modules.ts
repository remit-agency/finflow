// Module tabs of the shell (S01A): only modules that exist. New tabs arrive with their modules.

export type ModuleKey = 'transactions' | 'recurring' | 'analytics' | 'invoices' | 'calendar' | 'rules'

export interface ModuleTab {
  /** Also the slug of the label: the UI shows `t('shell.modules.<key>')`. */
  key: ModuleKey
  /** The path after the org id that belongs to this module: one segment, or more (`analytics/calendar`). The longest match wins. */
  segment: string
  href: (orgId: string) => string
}

// The order of Finmap's top menu: Płatności, (planned payments, kept on the owner's request), Analityka, Faktury, Kalendarz,
// Reguły automatyzacji. «Faktury» is a «soon» page until S19/S20; «Kalendarz» opens the calendar that lives under Analytics.
export const MODULE_TABS: readonly ModuleTab[] = [
  { key: 'transactions', segment: 'transactions', href: (orgId) => `/${orgId}/transactions` },
  { key: 'recurring', segment: 'recurring', href: (orgId) => `/${orgId}/recurring` },
  { key: 'analytics', segment: 'analytics', href: (orgId) => `/${orgId}/analytics/cashflow` },
  { key: 'invoices', segment: 'invoices', href: (orgId) => `/${orgId}/invoices` },
  { key: 'calendar', segment: 'analytics/calendar', href: (orgId) => `/${orgId}/analytics/calendar` },
  { key: 'rules', segment: 'rules', href: (orgId) => `/${orgId}/rules` },
]

/** The module a pathname belongs to: the longest tab path that is a whole-segment prefix of what follows `/<orgId>/`, or null. */
export function activeModule(pathname: string, orgId: string): ModuleKey | null {
  const prefix = `/${orgId}/`
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length).replace(/\/+$/, '')
  let best: ModuleTab | null = null
  for (const tab of MODULE_TABS) {
    if ((rest === tab.segment || rest.startsWith(`${tab.segment}/`)) && (best === null || tab.segment.length > best.segment.length)) best = tab
  }
  return best?.key ?? null
}

/** True on the journal page `/<orgId>/transactions` (a trailing slash is allowed). */
export function isJournalPath(pathname: string, orgId: string): boolean {
  const journal = `/${orgId}/transactions`
  return pathname === journal || pathname === `${journal}/`
}
