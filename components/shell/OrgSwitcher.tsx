'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getMyOrganizations } from '@/lib/firebase/members'
import { useAuth } from '@/lib/hooks/useAuth'
import { useShell } from '@/lib/hooks/useShell'
import type { Organization } from '@/types'

type OrgList =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; orgs: Organization[] }

// Company switcher. The list is fetched each time the menu opens (from the event handler, not an
// effect). Creating a company is S16.
export function OrgSwitcher() {
  const t = useTranslations('shell.orgSwitcher')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const { user } = useAuth()
  // chooseOrg navigates and loads the org in an order that keeps the shell's "URL org wins" sync quiet.
  const { orgId, org, chooseOrg } = useShell()
  const [list, setList] = useState<OrgList>({ status: 'idle' })

  const load = async () => {
    if (!user) return
    setList({ status: 'loading' })
    try {
      setList({ status: 'ready', orgs: await getMyOrganizations(user.uid) })
    } catch {
      setList({ status: 'error' })
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load()
      }}
    >
      <DropdownMenuTrigger
        data-testid="org-switcher"
        className="flex min-w-0 max-w-64 items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand-soft-foreground"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-brand font-display text-sm font-semibold text-ink">
          {org ? org.name.charAt(0).toUpperCase() : 'F'}
        </span>
        <span className="min-w-0">
          <span className="block text-xs text-ink-muted">{t('company')}</span>
          {org ? (
            <span data-testid="org-switcher-name" className="block truncate text-sm font-semibold text-ink">
              {org.name}
            </span>
          ) : (
            <span className="mt-1 block h-3.5 w-24 animate-pulse rounded bg-line" />
          )}
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('yourCompanies')}</DropdownMenuLabel>
          {(list.status === 'idle' || list.status === 'loading') && (
            <DropdownMenuItem disabled>{tCommon('loading')}</DropdownMenuItem>
          )}
          {list.status === 'error' && <DropdownMenuItem disabled>{tErrors('loadOrgs')}</DropdownMenuItem>}
          {list.status === 'ready' &&
            list.orgs.map((o) => (
              <DropdownMenuItem key={o.id} onClick={() => chooseOrg(o.id)}>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="text-xs text-ink-muted">{o.currency}</span>
                {o.id === orgId && <Check className="text-brand" aria-label={t('current')} />}
              </DropdownMenuItem>
            ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
