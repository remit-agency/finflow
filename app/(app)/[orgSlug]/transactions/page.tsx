'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { TransactionFiltersBar } from '@/components/transactions/TransactionFilters'
import { TransactionList } from '@/components/transactions/TransactionList'
import { useShell } from '@/lib/hooks/useShell'
import { useTransactions } from '@/lib/hooks/useTransactions'
import { PAGE_CONTAINER } from '@/lib/ui/layout'
import { cn } from '@/lib/utils'
import type { TransactionFilters } from '@/lib/firebase/transactions'

export default function TransactionsPage() {
  const t = useTranslations('journal')
  const { orgId, accounts, incomeCategories, expenseCategories, selectedAccountId, selectAccount } = useShell()
  const [filters, setFilters] = useState<TransactionFilters>({})

  // The account filter is the shell's selected account (sidebar and toolbar select share it).
  const effectiveFilters: TransactionFilters = {
    ...filters,
    accountId: selectedAccountId ?? undefined,
  }

  // The journal also lists planned operations; the flag stays out of `filters` so it never counts as an active filter.
  const { grouped, loading } = useTransactions(orgId, { ...effectiveFilters, includePlanned: true })
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return (
    <div className={cn(PAGE_CONTAINER, 'space-y-4 pt-2 lg:pt-2')}>
      {/* The active tab already names the page; the heading stays for screen readers. */}
      <h1 className="sr-only">{t('title')}</h1>

      <TransactionFiltersBar
        accessory={
          selectedAccount && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-soft pr-1.5 pl-3 text-sm font-medium text-brand-soft-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: selectedAccount.color }} />
              <span className="max-w-40 truncate">{selectedAccount.name}</span>
              <button
                type="button"
                onClick={() => selectAccount(null)}
                aria-label={t('showAllAccounts')}
                className="flex size-6 items-center justify-center rounded-full hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand-soft-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
          )
        }
        accounts={accounts}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        filters={effectiveFilters}
        onChange={(next) => {
          // The account lives in the shell (sidebar selection): the toolbar select shows and changes
          // that one value, so the two controls never disagree.
          const { accountId, ...rest } = next
          setFilters(rest)
          if (accountId !== selectedAccountId) selectAccount(accountId ?? null)
        }}
      />

      <TransactionList
        grouped={grouped}
        accounts={accounts}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        orgId={orgId}
        loading={loading}
      />
    </div>
  )
}
