import { describe, expect, it } from 'vitest'
import uk from '@/messages/uk.json'
import pl from '@/messages/pl.json'
import en from '@/messages/en.json'
import { MODULE_TABS } from '@/lib/shell/modules'
import { ANALYTICS_SECTIONS } from '@/lib/shell/analytics-sections'
import { SETTINGS_SECTIONS } from '@/lib/shell/settings-sections'
import { ROLES } from '@/lib/shell/permissions'

// The shell constants carry slugs; the labels live in the catalogs. A slug without a label would
// render a missing-message key, so every slug must be present in every language.
const catalogs = { uk, pl, en }

describe.each(Object.entries(catalogs))('%s shell labels', (_locale, messages) => {
  it('has a label for every module tab', () => {
    for (const tab of MODULE_TABS) expect(messages.shell.modules, tab.key).toHaveProperty(tab.key)
  })

  it('has a label for every analytics section', () => {
    for (const section of ANALYTICS_SECTIONS) expect(messages.shell.analyticsSections, section.slug).toHaveProperty(section.slug)
  })

  it('has a label for every settings section', () => {
    for (const section of SETTINGS_SECTIONS) expect(messages.shell.settingsSections, section.slug).toHaveProperty(section.slug)
  })

  it('has a label for every role', () => {
    for (const role of ROLES) expect(messages.roles, role).toHaveProperty(role)
  })

  it('has a label for every account type', () => {
    for (const type of ['bank', 'cash', 'card', 'crypto']) expect(messages.common.accountTypes, type).toHaveProperty(type)
  })
})
