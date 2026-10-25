// Settings sections (S01A). Pure: used by the settings layout, the index redirect and tests.

import { can, type Action, type Role } from '@/lib/shell/permissions'

export type SettingsSection = 'company' | 'categories' | 'banks' | 'subscription'

// The label of a section is `t('shell.settingsSections.<slug>')`.
export const SETTINGS_SECTIONS: ReadonlyArray<{ slug: SettingsSection }> = [
  { slug: 'company' },
  { slug: 'categories' },
  { slug: 'banks' },
  { slug: 'subscription' },
]

export function settingsPath(orgId: string, section: SettingsSection): string {
  return `/${encodeURIComponent(orgId)}/settings/${section}`
}

/**
 * True anywhere under `/<org>/settings` (the index too). The shell then swaps its left column:
 * the settings menu replaces the accounts sidebar and the module tabs are hidden (as in Finmap).
 */
export function isSettingsPath(pathname: string, orgId: string): boolean {
  const base = `/${encodeURIComponent(orgId)}/settings`
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** The section a pathname belongs to (`/<org>/settings/<section>/...`), or null. */
export function activeSettingsSection(pathname: string, orgId: string): SettingsSection | null {
  const prefix = `/${encodeURIComponent(orgId)}/settings/`
  if (!pathname.startsWith(prefix)) return null
  const slug = pathname.slice(prefix.length).split('/')[0]
  return SETTINGS_SECTIONS.find((s) => s.slug === slug)?.slug ?? null
}

type Query = Record<string, string | string[] | undefined>

/**
 * Where the old single settings page (`/<org>/settings`) sends a visitor. A bank return value
 * (`eb_auth`, `eb_error`) belongs to the Banks section; there only `eb_auth` is consumed
 * (EnableBankingConnect does not read `eb_error` yet); everything else goes to Company. The query string is kept as is.
 */
export function settingsIndexRedirect(orgId: string, query: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  const section: SettingsSection = params.has('eb_auth') || params.has('eb_error') ? 'banks' : 'company'
  const qs = params.toString()
  return qs ? `${settingsPath(orgId, section)}?${qs}` : settingsPath(orgId, section)
}

const REQUIRED_ACTION: Partial<Record<SettingsSection, Action>> = {
  banks: 'bank.manage',
  subscription: 'subscription.view',
}

/** Whether the role may open the section (company and categories are visible to every member). */
export function canOpenSection(role: Role | null, section: SettingsSection): boolean {
  const action = REQUIRED_ACTION[section]
  return action ? can(role, action) : role !== null
}

export function visibleSettingsSections(role: Role | null): typeof SETTINGS_SECTIONS {
  return SETTINGS_SECTIONS.filter((s) => canOpenSection(role, s.slug))
}
