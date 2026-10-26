// Module tabs of the shell (S01A): only modules that exist. New tabs arrive with their modules.

export type ModuleKey = 'transactions' | 'analytics'

export interface ModuleTab {
  /** Also the slug of the label: the UI shows `t('shell.modules.<key>')`. */
  key: ModuleKey
  /** First path segment after the org id that belongs to this module. */
  segment: string
  href: (orgId: string) => string
}

export const MODULE_TABS: readonly ModuleTab[] = [
  { key: 'transactions', segment: 'transactions', href: (orgId) => `/${orgId}/transactions` },
  { key: 'analytics', segment: 'analytics', href: (orgId) => `/${orgId}/analytics/cashflow` },
]

/** The module a pathname belongs to: the whole first segment after `/<orgId>/`, or null. */
export function activeModule(pathname: string, orgId: string): ModuleKey | null {
  const prefix = `/${orgId}/`
  if (!pathname.startsWith(prefix)) return null
  const segment = pathname.slice(prefix.length).split('/')[0]
  return MODULE_TABS.find((tab) => tab.segment === segment)?.key ?? null
}

/** True on the journal page `/<orgId>/transactions` (a trailing slash is allowed). */
export function isJournalPath(pathname: string, orgId: string): boolean {
  const journal = `/${orgId}/transactions`
  return pathname === journal || pathname === `${journal}/`
}
