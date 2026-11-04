'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import { MAX_FILTER_IDS } from '@/lib/domain/journal/filter'
import { highlightedRow } from '@/lib/ui/highlight'
import { cn } from '@/lib/utils'

/** Rows the open list shows at most; the search narrows the rest. */
const MAX_ROWS = 100

export interface FilterOption {
  id: string
  label: string
  /** A colour mark before the label (a tag, an account, a category). */
  marker?: ReactNode
  /** A short muted note after the label («не враховується в аналітиці»). */
  note?: string
  /** Archived: still offered (old operations carry it), shown muted. */
  muted?: boolean
  /** Indented under the row above it (a category under its payment type). */
  nested?: boolean
  /** Not counted against the list limit, shown bold (a payment type above its categories). */
  free?: boolean
}

interface Props {
  /** The field's name; the closed field reads «Теги (2)» once something is chosen. */
  label: string
  /** The first row: ticked while nothing is chosen; ticking it clears the choice («Усі теги»). */
  allLabel: string
  /** The search field's placeholder and name («Пошук тегів»). */
  searchLabel: string
  options: FilterOption[]
  /** The chosen ids: the dialog's draft. */
  value: string[]
  onChange: (ids: string[]) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  /** No more ids may be added (the 30-id limit of the address): rows not chosen yet, except `free` ones, are disabled. */
  full?: boolean
  disabled?: boolean
}

type Row = { kind: 'all' } | { kind: 'option'; option: FilterOption }

/**
 * A multiple choice the way Finmap's «Filtry» shows it (S10f): the field opens a list under itself with a search, «Усі …»
 * first, one checkbox row per value and «Вибрати». A tick goes to the dialog's draft at once; «Вибрати» and Esc close the
 * list. The highlight follows S10t: nothing is highlighted until the person types, presses an arrow or really moves the
 * pointer, so Enter never ticks a row by accident.
 */
export function FilterMultiSelect({ label, allLabel, searchLabel, options, value, onChange, open, onOpenChange, full = false, disabled }: Props) {
  const t = useTranslations('analytics.filters')
  const panelId = useId()
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  // The row the person moved the highlight to; null until they do.
  const [moved, setMoved] = useState<number | null>(null)
  // Where the pointer was when it last entered or moved over a row: only a real move may move the highlight (S10t).
  const pointer = useRef<string | null>(null)

  const q = nameKeyText(query)
  const matching = q === '' ? options : options.filter((o) => nameKeyText(o.label).includes(q))
  // While searching there is no «Усі …» row, so the first match (highlighted by typing) is never «clear the choice».
  const head: Row[] = q === '' ? [{ kind: 'all' }] : []
  const rows: Row[] = [...head, ...matching.slice(0, MAX_ROWS).map((option): Row => ({ kind: 'option', option }))]
  const hidden = Math.max(0, matching.length - MAX_ROWS)
  const highlighted = highlightedRow(rows.length, q, moved)
  const chosen = new Set(value)
  const count = value.length

  const close = () => {
    onOpenChange(false)
    setQuery('')
    setMoved(null)
    pointer.current = null
    triggerRef.current?.focus()
  }
  const blocked = (row: Row): boolean => row.kind === 'option' && full && !chosen.has(row.option.id) && row.option.free !== true
  const toggle = (row: Row) => {
    if (row.kind === 'all') onChange([])
    else if (chosen.has(row.option.id)) onChange(value.filter((id) => id !== row.option.id))
    else if (!blocked(row)) onChange([...value, row.option.id])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (rows.length > 0) setMoved(Math.min(highlighted + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length > 0) setMoved(Math.max(highlighted - 1, 0))
    } else if (e.key === 'Enter') {
      // Enter never submits and never ticks a row nobody highlighted.
      e.preventDefault()
      if (highlighted >= 0) toggle(rows[highlighted])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Closing the list must not also close the dialog around it.
      e.stopPropagation()
      close()
    }
  }

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setQuery('')
          setMoved(null)
          onOpenChange(true)
        }}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-field border border-line bg-surface px-3 text-left text-sm text-ink transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground disabled:opacity-50',
          count > 0 && 'border-brand',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{count > 0 ? `${label} (${count})` : label}</span>
        <ChevronDownIcon aria-hidden className={cn('size-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={panelId} className="mt-1 space-y-2 rounded-field border border-line bg-surface p-2 shadow-pop">
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              // Typing highlights the first match again.
              setMoved(null)
            }}
            onKeyDown={onKeyDown}
            className="h-9 rounded-control border-line bg-surface"
          />
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 overflow-y-auto">
            {rows.map((row, index) => {
              const checked = row.kind === 'all' ? count === 0 : chosen.has(row.option.id)
              const off = blocked(row)
              return (
                <li
                  key={row.kind === 'all' ? 'all' : `o:${row.option.id}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={off || undefined}
                  // mousedown keeps the focus in the search field; the click ticks the row.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(row)}
                  onMouseEnter={(e) => {
                    pointer.current = `${e.screenX},${e.screenY}`
                  }}
                  onMouseMove={(e) => {
                    const at = `${e.screenX},${e.screenY}`
                    if (at === pointer.current) return
                    pointer.current = at
                    setMoved(index)
                  }}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-control px-2 py-2 text-sm text-ink',
                    index === highlighted && 'bg-canvas',
                    row.kind === 'option' && row.option.nested && 'pl-7',
                    off && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                      checked ? 'border-brand bg-brand text-ink' : 'border-line bg-surface',
                    )}
                  >
                    {checked && <CheckIcon className="size-3" strokeWidth={3} />}
                  </span>
                  {row.kind === 'all' ? (
                    <span className="min-w-0 flex-1 break-words font-medium">{allLabel}</span>
                  ) : (
                    <>
                      {row.option.marker && <span className="mt-1.5 flex shrink-0">{row.option.marker}</span>}
                      <span className={cn('min-w-0 flex-1 break-words', row.option.muted && 'text-ink-muted', row.option.free && 'font-medium')}>
                        {row.option.label}
                        {row.option.note && (
                          <>
                            {' '}
                            <span className="text-xs text-ink-muted">{row.option.note}</span>
                          </>
                        )}
                      </span>
                    </>
                  )}
                </li>
              )
            })}
            {matching.length === 0 && (
              <li role="presentation" className="px-2 py-2 text-sm text-ink-muted">
                {t('noMatches')}
              </li>
            )}
          </ul>
          {hidden > 0 && <p className="px-2 text-xs text-ink-muted">{t('more', { count: hidden })}</p>}
          {full && <p className="px-2 text-xs text-ink-muted">{t('full', { max: MAX_FILTER_IDS })}</p>}
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={close}>
              {t('choose')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
