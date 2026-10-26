'use client'

import { useRef, useState } from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { cn } from '@/lib/utils'
import { useFormatters } from '@/lib/i18n/useFormatters'
import {
  REPORT_PERIOD_PRESETS,
  formatPeriodLabel,
  type PeriodPreset,
  type PeriodSelection,
} from '@/lib/utils/period'
import { todayUtcDay } from '@/lib/utils/today'

export interface PeriodSelectProps {
  value: PeriodSelection
  onChange: (value: PeriodSelection) => void
  /** Menu entries in order; `custom` opens the date range picker. Default: the reports' presets. */
  presets?: readonly PeriodPreset[]
  className?: string
}

/** Toolbar pill of the report pages (Finmap's «Na bieżący rok ▾» structure, FinFlow look). */
export const TOOLBAR_PILL =
  'inline-flex h-11 items-center gap-2 rounded-field bg-canvas px-4 text-sm font-semibold text-ink transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground sm:h-10'

/**
 * The period filter of the reports: a pill with the selected period that opens a menu of presets
 * (`menuitemradio`, the selected one bold with a check) under the header `periods.menuHeader`.
 * The `custom` entry closes the menu and opens a date range picker anchored to the pill; the
 * picker's apply button makes the range a custom period, cancel / Esc / a click outside keep the
 * old one. Focus returns to the pill in every case.
 */
export function PeriodSelect({ value, onChange, presets = REPORT_PERIOD_PRESETS, className }: PeriodSelectProps) {
  const t = useTranslations('periods')
  const { locale } = useFormatters()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // The custom entry was chosen: open the picker once the menu has finished closing (and handed
  // focus back to the pill), so the two layers never fight over focus.
  const openPickerAfterMenu = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dayRef = useRef<HTMLButtonElement>(null)
  // Warsaw's date, read once per visit.
  const [today] = useState(() => todayUtcDay())
  const label = formatPeriodLabel(value, locale, (preset) => t(preset))
  const open = menuOpen || pickerOpen

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen && openPickerAfterMenu.current) {
            openPickerAfterMenu.current = false
            setPickerOpen(true)
          }
        }}
      >
        <DropdownMenuTrigger
          ref={triggerRef}
          data-testid="period-select"
          data-open={open || undefined}
          className={cn(TOOLBAR_PILL, 'max-w-full', className)}
        >
          <span className="sr-only">{t('srLabel')}</span>
          <span className="truncate">{label}</span>
          <ChevronDownIcon
            aria-hidden
            className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sideOffset={6}
          className="w-auto min-w-72 max-w-[calc(100vw-2rem)] rounded-panel p-2 shadow-pop ring-1 ring-line"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              {t('menuHeader')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={value.preset}
              onValueChange={(next) => {
                // `custom` only opens the picker (onClick below); the range applies on the picker's apply button.
                if (next !== 'custom') onChange({ preset: next as PeriodPreset })
              }}
            >
              {presets.map((preset) => (
                <MenuPrimitive.RadioItem
                  key={preset}
                  value={preset}
                  closeOnClick
                  onClick={preset === 'custom' ? () => { openPickerAfterMenu.current = true } : undefined}
                  className="relative flex min-h-12 cursor-default items-center rounded-control py-2.5 pr-12 pl-4 text-[15px] text-ink outline-none select-none data-checked:font-semibold data-highlighted:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-soft-foreground"
                >
                  {t(preset)}
                  <MenuPrimitive.RadioItemIndicator className="absolute right-4 flex items-center text-brand-soft-foreground">
                    <CheckIcon aria-hidden className="size-5" strokeWidth={2.5} />
                  </MenuPrimitive.RadioItemIndicator>
                </MenuPrimitive.RadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <PopoverPrimitive.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner
            anchor={triggerRef}
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className="isolate z-50 outline-none"
          >
            <PopoverPrimitive.Popup
              aria-label={t('custom')}
              initialFocus={dayRef}
              finalFocus={triggerRef}
              data-testid="period-picker"
              className="rounded-panel bg-popover p-4 text-popover-foreground shadow-pop ring-1 ring-line outline-none"
            >
              <DateRangePicker
                today={today}
                initialStart={value.preset === 'custom' ? value.start : null}
                initialEnd={value.preset === 'custom' ? value.end : null}
                focusTargetRef={dayRef}
                onCancel={() => setPickerOpen(false)}
                onApply={(start, end) => {
                  onChange({ preset: 'custom', start, end })
                  setPickerOpen(false)
                }}
              />
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </>
  )
}
