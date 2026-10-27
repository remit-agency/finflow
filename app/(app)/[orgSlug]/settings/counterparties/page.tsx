'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Pencil, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CounterpartyForm } from '@/components/counterparties/CounterpartyForm'
import { filterCounterparties } from '@/lib/domain/counterparties/search'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'

const BADGE = 'rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink-muted'

export default function CounterpartiesSettingsPage() {
  const t = useTranslations('settings.counterparties')
  const { orgId, can } = useShell()
  const canEdit = can('data.write')
  const { counterparties, loading } = useCounterparties(orgId)

  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // `'new'`: the create form; a counterparty: its edit form.
  const [editing, setEditing] = useState<Counterparty | 'new' | null>(null)

  const rows = useMemo(
    () => filterCounterparties(counterparties, query, { includeArchived: showArchived }),
    [counterparties, query, showArchived],
  )

  return (
    <Card className="ring-line">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing('new')}>
            <Plus />
            {t('add')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {t('showArchived')}
          </label>
        </div>

        {loading ? null : rows.length === 0 ? (
          <p className="text-sm text-ink-muted">{counterparties.length === 0 ? t('empty') : t('noMatches')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id} data-testid="counterparty-row" className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={c.archived ? 'font-medium text-ink-muted' : 'font-medium text-ink'}>{c.name}</span>
                    {c.kind && <span className={BADGE}>{t('systemBadge')}</span>}
                    {c.archived && <span className={BADGE}>{t('archivedBadge')}</span>}
                    {c.vat && <span className={BADGE}>{t(`vat.${c.vat.status}`)}</span>}
                  </div>
                  {(c.nip || c.address) && (
                    <p className="truncate text-xs text-ink-muted">{[c.nip && `NIP ${c.nip}`, c.address].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                {canEdit && (
                  <Button variant="ghost" size="icon" aria-label={t('edit', { name: c.name })} onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing !== null && (
        <CounterpartyForm
          key={editing === 'new' ? 'new' : editing.id}
          orgId={orgId}
          counterparty={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}
