'use client'

import { useTranslations } from 'next-intl'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { ListedRule, RuleCondition } from '@/lib/domain/rules/types'
import type { Tag } from '@/lib/domain/tags/types'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import type { Account, Category } from '@/types'

interface Props {
  rule: ListedRule
  accounts: Account[]
  categories: Category[]
  counterparties: Counterparty[]
  tags: Tag[]
}

/** One line under the rule's name: what it checks, then what it sets. A deleted account, category, counterparty or tag reads «(видалено)». */
export function RuleSummary({ rule, accounts, categories, counterparties, tags }: Props) {
  const t = useTranslations('settings.rules.summary')
  const { money } = useFormatters()
  const categoryName = useCategoryName()

  const condition = (c: RuleCondition): string => {
    if (c.kind === 'text') return t(c.op, { values: c.values.join(', ') })
    if (c.kind === 'account') {
      return t('account', { names: c.accountIds.map((id) => accounts.find((a) => a.id === id)?.name ?? t('missing')).join(', ') })
    }
    const min = c.minMinor === undefined ? null : money(fromMinor(c.minMinor), c.currency)
    const max = c.maxMinor === undefined ? null : money(fromMinor(c.maxMinor), c.currency)
    if (min !== null && max !== null) return t('amountRange', { min, max })
    return min !== null ? t('amountMin', { min }) : t('amountMax', { max: max ?? '' })
  }

  const { categoryId, counterpartyId, tagIds } = rule.actions
  const category = categoryId === undefined ? undefined : categories.find((c) => c.id === categoryId)
  const counterparty = counterpartyId === undefined ? undefined : counterparties.find((c) => c.id === counterpartyId)
  const actions: string[] = []
  if (categoryId !== undefined) actions.push(t('category', { name: category ? categoryName(category) : t('missing') }))
  if (counterpartyId !== undefined) actions.push(t('counterparty', { name: counterparty?.name ?? t('missing') }))
  if (tagIds !== undefined) actions.push(t('tags', { names: tagIds.map((id) => tags.find((x) => x.id === id)?.name ?? t('missing')).join(', ') }))

  return (
    <p className="text-xs text-ink-muted">
      {rule.conditions.map(condition).join(' · ')} → {actions.join(', ')}
    </p>
  )
}
