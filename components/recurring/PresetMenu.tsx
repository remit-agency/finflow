'use client'

import { useTranslations } from 'next-intl'
import { ChevronDownIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PRESETS, type Preset } from '@/lib/domain/recurring/types'
import { cn } from '@/lib/utils'

/** «Додати з пресету»: ZUS, PIT-4, VAT-7 (S11). */
export function PresetMenu({ onPick }: { onPick: (preset: Preset) => void }) {
  const t = useTranslations('recurring')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="preset-menu" className={cn(buttonVariants({ variant: 'soft' }), 'gap-1')}>
        {t('series.addPreset')}
        <ChevronDownIcon aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={6} className="min-w-44 rounded-panel p-1 shadow-pop ring-1 ring-line">
        {PRESETS.map((p) => (
          <DropdownMenuItem key={p} data-testid={`preset-${p}`} onClick={() => onPick(p)}>
            {t(`presets.${p}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
