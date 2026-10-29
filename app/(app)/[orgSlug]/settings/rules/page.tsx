'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react'
import { ApplyRulesDialog } from '@/components/rules/ApplyRulesDialog'
import { RuleEditor } from '@/components/rules/RuleEditor'
import { RuleSummary } from '@/components/rules/RuleSummary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { orderRules, updateRule } from '@/lib/api/rules-client'
import { MAX_RULES, type ListedRule } from '@/lib/domain/rules/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useRules } from '@/lib/hooks/useRules'
import { useShell } from '@/lib/hooks/useShell'

export default function RulesSettingsPage() {
  const t = useTranslations('settings.rules')
  const { orgId, org, can, accounts, incomeCategories, expenseCategories } = useShell()
  const canEdit = can('data.write')
  const { rules, loading, error, refreshing, reload } = useRules(orgId)
  const { counterparties } = useCounterparties(orgId)
  // 'new': the editor of a new rule; a rule: its editor.
  const [editing, setEditing] = useState<ListedRule | 'new' | null>(null)
  const [applying, setApplying] = useState(false)
  const [busy, setBusy] = useState(false)
  // Still busy while the list is read again: a click then would send an order computed from the list before the last change.
  const locked = busy || refreshing
  const categories = [...incomeCategories, ...expenseCategories]

  /** A change made from the list (order, the active switch): one at a time, then the list is read again. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      toast.error(e instanceof LedgerApiError && e.code === 'conflict' ? t('errors.conflict') : t('errors.save'))
    } finally {
      setBusy(false)
      reload()
    }
  }

  const move = (index: number, by: -1 | 1) => {
    const ids = rules.map((r) => r.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + by, 0, moved)
    void run(() => orderRules(orgId, ids))
  }

  return (
    <Card className="ring-line">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" onClick={() => setApplying(true)} disabled={rules.length === 0}>
              {t('applyOpen')}
            </Button>
            <Button onClick={() => setEditing('new')} disabled={loading || rules.length >= MAX_RULES}>
              <Plus />
              {t('add')}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-expense">{t('loadError')}</p>
        ) : loading ? null : rules.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((rule, index) => (
              <li key={rule.id} data-testid="rule-row" className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={rule.active ? 'font-medium text-ink' : 'font-medium text-ink-muted'}>{rule.name}</span>
                    <Badge variant="chip">{t(`type.${rule.type}`)}</Badge>
                    {!rule.active && <Badge variant="chip">{t('inactive')}</Badge>}
                    {rule.unusable.length > 0 && (
                      <Badge variant="chip" data-testid="rule-unusable" className="text-expense">
                        {t('unusable')}
                      </Badge>
                    )}
                  </div>
                  <RuleSummary rule={rule} accounts={accounts} categories={categories} counterparties={counterparties} />
                  {/* Visible text, not a tooltip: a phone has no hover. */}
                  {rule.unusable.length > 0 && <p className="text-xs text-expense">{t('unusableHint')}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      type="checkbox"
                      className="mr-1 accent-brand"
                      aria-label={t('active', { name: rule.name })}
                      checked={rule.active}
                      disabled={locked}
                      onChange={() => void run(() => updateRule(orgId, rule.id, { active: !rule.active }))}
                    />
                    <Button variant="ghost" size="icon" aria-label={t('moveUp', { name: rule.name })} disabled={locked || index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('moveDown', { name: rule.name })}
                      disabled={locked || index === rules.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t('edit', { name: rule.name })} onClick={() => setEditing(rule)}>
                      <Pencil />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing !== null && (
        <RuleEditor
          key={editing === 'new' ? 'new' : editing.id}
          orgId={orgId}
          rule={editing === 'new' ? undefined : editing}
          accounts={accounts}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          counterparties={counterparties}
          currency={org?.currency ?? ''}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {/* Keyed by company: a company switch restarts the count for the new one (an apply of the old one was aborted). */}
      {applying && <ApplyRulesDialog key={orgId} orgId={orgId} onClose={() => setApplying(false)} />}
    </Card>
  )
}
