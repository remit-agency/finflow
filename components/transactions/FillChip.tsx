'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { CounterpartyPicker } from '@/components/counterparties/CounterpartyPicker'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import type { Category } from '@/types'

interface Props {
  field: 'category' | 'counterparty'
  /** Categories of the operation's own type (a category has a type). */
  categories: Category[]
  counterparties: Counterparty[]
  /** Saves the one value; resolves when the server answered, rejects when it refused. */
  onSave: (value: string) => Promise<void>
}

/** The green «вкажіть» chip of an empty category or counterparty: a popover with one choice and «Save». */
export function FillChip({ field, categories, counterparties, onSave }: Props) {
  const t = useTranslations('journal.list')
  const categoryName = useCategoryName()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!value) return
    setBusy(true)
    try {
      await onSave(value)
      setOpen(false)
    } catch {
      // The caller has already told the person why; the popover stays open for another choice.
    } finally {
      setBusy(false)
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        render={
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-soft-foreground hover:bg-brand-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground"
          />
        }
      >
        {t('fill')}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={6} collisionPadding={16} className="isolate z-50 outline-none">
          <PopoverPrimitive.Popup
            onClick={(e) => e.stopPropagation()}
            className="w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-panel bg-popover p-3 text-popover-foreground shadow-pop ring-1 ring-line outline-none"
          >
            <p className="text-sm font-medium text-ink">{field === 'category' ? t('fillCategory') : t('fillCounterparty')}</p>
            {field === 'category' ? (
              <NativeSelect value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('fillCategory')} className="border-line">
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryName(c)}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <CounterpartyPicker counterparties={counterparties.filter((c) => !c.archived)} value={value || null} onChange={(id) => setValue(id ?? '')} />
            )}
            <div className="flex justify-end">
              <Button type="button" size="sm" disabled={!value || busy} onClick={save}>
                {t('fillSave')}
              </Button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
