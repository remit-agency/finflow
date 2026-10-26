import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { SettingsMenu } from '@/components/shell/SettingsMenu'
import { PAGE_CONTAINER } from '@/lib/ui/layout'
import { cn } from '@/lib/utils'

// Only the content: the settings menu is the shell's left column from 1024 px (AppShell) and a
// pill row on top of the content below it. The forms keep a readable width inside the shared container.
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('settings')
  return (
    <div className={cn(PAGE_CONTAINER, 'space-y-5')}>
      <SettingsMenu variant="pills" />
      <div className="max-w-[680px] space-y-5">
        <h1 className="font-display text-xl font-semibold text-ink">{t('title')}</h1>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
