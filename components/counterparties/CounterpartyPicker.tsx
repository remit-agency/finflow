'use client'

import { useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { filterCounterparties } from '@/lib/domain/counterparties/search'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { cn } from '@/lib/utils'

const MAX_OPTIONS = 50

type Row = { kind: 'none' } | { kind: 'item'; counterparty: Counterparty } | { kind: 'create' }

interface Props {
  /** The company's counterparties (archived ones may be included: the selected one is shown even then). */
  counterparties: Counterparty[]
  value: string | null
  onChange: (id: string | null) => void
  /** When given, the last option creates a counterparty; the parent opens its form with what was typed. */
  onCreate?: (typed: string) => void
  disabled?: boolean
  id?: string
}

/** A searchable single choice of a counterparty (name or NIP), with «none» and an optional «add» option. */
export function CounterpartyPicker({ counterparties, value, onChange, onCreate, disabled, id }: Props) {
  const t = useTranslations('settings.counterparties.picker')
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const selected = counterparties.find((c) => c.id === value) ?? null
  const matches = useMemo(() => filterCounterparties(counterparties, query).slice(0, MAX_OPTIONS), [counterparties, query])
  const rows: Row[] = [
    { kind: 'none' },
    ...matches.map((counterparty): Row => ({ kind: 'item', counterparty })),
    ...(onCreate ? [{ kind: 'create' } as Row] : []),
  ]

  /** `active` can outlive the rows it pointed at when the query narrows the list. */
  const activeIndex = Math.min(active, rows.length - 1)

  const close = () => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  const choose = (row: Row) => {
    if (row.kind === 'none') onChange(null)
    else if (row.kind === 'item') onChange(row.counterparty.id)
    else onCreate?.(query)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive(Math.min(activeIndex + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      const row = rows[activeIndex]
      // Nothing matched what was typed: Enter must not clear the selection (a click on «none» still does).
      if (row.kind === 'none' && query !== '') return
      choose(row)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      // Closing the list must not also close the dialog around it.
      e.stopPropagation()
      close()
    }
  }

  const label = (row: Row): string =>
    row.kind === 'none' ? t('none') : row.kind === 'create' ? t('create') : row.counterparty.name

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        aria-label={t('label')}
        placeholder={t('placeholder')}
        disabled={disabled}
        value={open ? query : (selected?.name ?? '')}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(1)
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
          // Start on the chosen counterparty, so Enter right after Tab keeps it instead of picking «none».
          const chosen = rows.findIndex((r) => r.kind === 'item' && r.counterparty.id === value)
          setActive(Math.max(chosen, 0))
        }}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('label')}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-panel"
        >
          {rows.map((row, index) => (
            <li
              key={row.kind === 'item' ? row.counterparty.id : row.kind}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={row.kind === 'item' && row.counterparty.id === value}
              // mousedown (not click) so the input's blur does not close the list before the choice is made.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(row)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', index === activeIndex && 'bg-canvas', row.kind === 'none' && 'text-ink-muted')}
            >
              {row.kind === 'create' && <Plus className="size-4" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{label(row)}</span>
              {row.kind === 'item' && row.counterparty.nip && <span className="text-xs text-ink-muted">{row.counterparty.nip}</span>}
              {row.kind === 'item' && row.counterparty.id === value && <Check className="size-4" aria-hidden />}
            </li>
          ))}
          {matches.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-ink-muted">{t('noMatches')}</li>}
        </ul>
      )}
    </div>
  )
}
