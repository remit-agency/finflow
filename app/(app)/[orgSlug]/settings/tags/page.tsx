'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Pencil, Plus } from 'lucide-react'
import { TagDot } from '@/components/tags/TagDot'
import { TagEditor } from '@/components/tags/TagEditor'
import { TagRecalcDialog } from '@/components/tags/TagRecalcDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MAX_TAGS, type Tag } from '@/lib/domain/tags/types'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'

export default function TagsSettingsPage() {
  const t = useTranslations('settings.tags')
  const { orgId, can } = useShell()
  const canEdit = can('data.write')
  const { tags, loading } = useTags(orgId)
  // 'new': the editor of a new tag; a tag: its editor.
  const [editing, setEditing] = useState<Tag | 'new' | null>(null)
  // The tag whose operations are being recalculated (after a flag change, or «Продовжити»).
  const [recalc, setRecalc] = useState<Tag | null>(null)
  const active = tags.filter((tag) => !tag.archived)
  const archived = tags.filter((tag) => tag.archived)
  const full = tags.length >= MAX_TAGS

  const row = (tag: Tag) => (
    <li key={tag.id} data-testid="tag-row" className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* The dot and the name stay together: a long name wraps under itself, not away from its dot. */}
          <span className="flex min-w-0 items-start gap-2">
            <TagDot color={tag.color} className="mt-2" />
            <span className={tag.archived ? 'min-w-0 font-medium break-words text-ink-muted' : 'min-w-0 font-medium break-words text-ink'}>{tag.name}</span>
          </span>
          {tag.excludeFromAnalytics && (
            <Badge variant="chip" data-testid="tag-excluded">
              {t('excludedBadge')}
            </Badge>
          )}
          {tag.archived && <Badge variant="chip">{t('archivedBadge')}</Badge>}
        </div>
        {/* Visible text, not a tooltip: a phone has no hover. */}
        {tag.recalcPending && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-expense">
            <span data-testid="tag-recalc-pending">{t('recalcPending')}</span>
            {canEdit && (
              <Button type="button" variant="soft" size="sm" onClick={() => setRecalc(tag)}>
                {t('recalcContinue')}
              </Button>
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <Button variant="ghost" size="icon" aria-label={t('edit', { name: tag.name })} onClick={() => setEditing(tag)}>
          <Pencil />
        </Button>
      )}
    </li>
  )

  return (
    <Card className="ring-line">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing('new')} disabled={loading || full}>
            <Plus />
            {t('add')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? null : tags.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('empty')}</p>
        ) : (
          <>
            {active.length > 0 && <ul className="divide-y divide-line">{active.map(row)}</ul>}
            {archived.length > 0 && (
              <section className="space-y-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('archivedTitle')}</h2>
                <ul className="divide-y divide-line">{archived.map(row)}</ul>
              </section>
            )}
          </>
        )}
        {canEdit && full && <p className="text-xs text-ink-muted">{t('limitHint')}</p>}
      </CardContent>

      {editing !== null && (
        <TagEditor
          key={editing === 'new' ? 'new' : editing.id}
          orgId={orgId}
          tag={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onRecalc={setRecalc}
        />
      )}
      {recalc !== null && <TagRecalcDialog key={recalc.id} orgId={orgId} tag={recalc} onClose={() => setRecalc(null)} />}
    </Card>
  )
}
