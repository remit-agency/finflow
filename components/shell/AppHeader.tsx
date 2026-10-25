'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowLeftRight, Menu, Minus, Plus } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { OrgSwitcher } from '@/components/shell/OrgSwitcher'
import { ProfileMenu } from '@/components/shell/ProfileMenu'
import { useShell } from '@/lib/hooks/useShell'
import { cn } from '@/lib/utils'

// Header CTAs open the global forms on every page; below 640 px they show icons only (the label
// stays as screen-reader text, so the accessible names never change). From 1024 px the header is
// three columns, as in Finmap: company on the left, the three equal-width CTAs centred, profile right.
export function AppHeader() {
  const t = useTranslations('shell.header')
  const { orgId, openTransactionForm, drawerOpen, setDrawerOpen, can, access } = useShell()
  const cta = 'lg:h-10 lg:min-w-32 lg:px-4'

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4 lg:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-4">
        <Button
          variant="ghost"
          size="icon-lg"
          className="lg:hidden"
          aria-label={t('openAccounts')}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu />
        </Button>
        <Link
          href={`/${orgId}/transactions`}
          className="hidden shrink-0 rounded-control font-display text-base font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-brand-soft-foreground lg:block"
        >
          Fin<span className="text-brand">Flow</span>
        </Link>
        {/* A flex container, so the switcher button is a shrinkable flex item and its name truncates. */}
        <div className="flex min-w-0 flex-1 lg:flex-none">
          <OrgSwitcher />
        </div>
      </div>
      {access.status === 'loading' ? (
        // Access is still loading: keep the group's space (same sizes, so the header does not jump)
        // but render nothing clickable or readable. Plain empty spans, hidden from the accessibility
        // tree and from focus. The sm widths approximate the labelled buttons; from lg the min-width is exact.
        <div aria-hidden className="invisible flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
          {['sm:w-[5.25rem]', 'sm:w-[6.25rem]', 'sm:w-[6.25rem]'].map((width, i) => (
            <span key={i} className={cn(buttonVariants({ size: 'lg' }), cta, 'w-9 px-0', width, 'lg:w-auto')} />
          ))}
        </div>
      ) : can('data.write') ? (
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
          <Button size="lg" onClick={() => openTransactionForm('income')} className={cn(cta, 'bg-income text-white hover:bg-income/90')}>
            <Plus />
            <span className="sr-only sm:not-sr-only">{t('income')}</span>
          </Button>
          <Button size="lg" onClick={() => openTransactionForm('expense')} className={cn(cta, 'bg-expense text-white hover:bg-expense/90')}>
            <Minus />
            <span className="sr-only sm:not-sr-only">{t('expense')}</span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => openTransactionForm('transfer')}
            className={cn(cta, 'border-line bg-surface text-ink hover:bg-canvas')}
          >
            <ArrowLeftRight />
            <span className="sr-only sm:not-sr-only">{t('transfer')}</span>
          </Button>
        </div>
      ) : (
        // A viewer (or no access): the empty slot keeps the three-column header grid.
        <div />
      )}
      <div className="flex shrink-0 items-center justify-end">
        <ProfileMenu />
      </div>
    </header>
  )
}
