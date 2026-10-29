// Settings sections (S01A). Pure: used by the settings layout, the index redirect and tests.

import { can, type Action, type Role } from '@/lib/shell/permissions'

export type SettingsSection = 'company' | 'language' | 'categories' | 'counterparties' | 'rules' | 'banks' | 'subscription'

// The label of a section is `t('shell.settingsSections.<slug>')`.
export const SETTINGS_SECTIONS: ReadonlyArray<{ slug: SettingsSection }> = [
  { slug: 'company' },
  { slug: 'language' },
  { slug: 'categories' },
  { slug: 'counterparties' },
  { slug: 'rules' },
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
 * (`eb_connected` or `eb_error`, set by the Enable Banking callback) belongs to the Banks section; everything else
 * goes to Company. The query string is kept as is.
 */
export function settingsIndexRedirect(orgId: string, query: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  const section: SettingsSection = params.has('eb_connected') || params.has('eb_error') ? 'banks' : 'company'
  const qs = params.toString()
  return qs ? `${settingsPath(orgId, section)}?${qs}` : settingsPath(orgId, section)
}

const REQUIRED_ACTION: Partial<Record<SettingsSection, Action>> = {
  banks: 'bank.manage',
  subscription: 'subscription.view',
}

/** Whether the role may open the section (company, language, categories, counterparties and rules are visible to every member). */
export function canOpenSection(role: Role | null, section: SettingsSection): boolean {
  const action = REQUIRED_ACTION[section]
  return action ? can(role, action) : role !== null
}

export function visibleSettingsSections(role: Role | null): typeof SETTINGS_SECTIONS {
  return SETTINGS_SECTIONS.filter((s) => canOpenSection(role, s.slug))
}
