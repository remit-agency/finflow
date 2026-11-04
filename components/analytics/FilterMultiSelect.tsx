'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { CheckIcon, ChevronDownIcon, MinusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import type { TriState } from '@/lib/domain/analytics-filter/kinds'
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
  /** A tree row's state, derived by the owner of the tree; without it the row is checked when its id is in `value`. */
  state?: TriState
  /** Indentation: 0 directly under the list's first row, one step deeper per level of a tree. */
  level?: number
  /** A tree row with children: open (`true`) or closed (`false`); absent for a row without children. */
  expanded?: boolean
  /** Hidden while nothing is searched (the rows under a closed row); a search finds them too. */
  collapsed?: boolean
  /** Not counted against the list limit, shown bold (a group above its rows). */
  free?: boolean
}

interface Props {
  /** The field's name; the closed field reads «Теги (2)» once something is chosen. */
  label: string
  /** The closed field's text and whether it marks a choice (the tree's summary); by default the count of `value`. */
  summary?: { text: string; active: boolean }
  /** The first row: ticked while nothing is chosen; ticking it clears the choice («Усі теги»). */
  allLabel: string
  /** The first row's state when it is not derived from `value` (the tree: dashed while something is restricted). */
  allState?: TriState
  /** The search field's placeholder and name («Пошук тегів»). */
  searchLabel: string
  options: FilterOption[]
  /** The chosen ids: the dialog's draft (a flat list). */
  value: string[]
  onChange: (ids: string[]) => void
  /** A tree: a tick on a row goes here with its id instead of `onChange` (the owner of the tree decides what it changes). */
  onRowToggle?: (id: string) => void
  /** A tree: the arrow of a row with children (or the arrow keys) asks for its state. */
  onExpand?: (id: string, expanded: boolean) => void
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
 * pointer, so Enter never ticks a row by accident. A tree (S10f) reuses the same list: its rows carry a state, a level and
 * an arrow; a dashed row is partly chosen.
 */
export function FilterMultiSelect({
  label,
  summary,
  allLabel,
  allState,
  searchLabel,
  options,
  value,
  onChange,
  onRowToggle,
  onExpand,
  open,
  onOpenChange,
  full = false,
  disabled,
}: Props) {
  const t = useTranslations('analytics.filters')
  const panelId = useId()
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  // The row the person moved the highlight to; null until they do.
  const [moved, setMoved] = useState<number | null>(null)
  // Where the pointer was when it last entered or moved over a row: only a real move may move the highlight (S10t).
  const pointer = useRef<string | null>(null)

  // A tree: every row keeps the arrow's place, so the boxes of one level line up whether or not a row has children.
  const tree = options.some((o) => o.level !== undefined)
  const q = nameKeyText(query)
  // Closed rows are hidden until something is searched; a search looks through every row.
  const shown = q === '' ? options.filter((o) => o.collapsed !== true) : options
  const matching = q === '' ? shown : shown.filter((o) => nameKeyText(o.label).includes(q))
  // While searching there is no «Усі …» row, so the first match (highlighted by typing) is never «clear the choice».
  const head: Row[] = q === '' ? [{ kind: 'all' }] : []
  const rows: Row[] = [...head, ...matching.slice(0, MAX_ROWS).map((option): Row => ({ kind: 'option', option }))]
  const hidden = Math.max(0, matching.length - MAX_ROWS)
  const highlighted = highlightedRow(rows.length, q, moved)
  const chosen = new Set(value)
  const count = value.length
  const active = summary ? summary.active : count > 0

  // The highlighted row stays in view while the arrow keys move it (the list scrolls, the page does not).
  useEffect(() => {
    if (open && highlighted >= 0) listRef.current?.children[highlighted]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, highlighted])

  const close = () => {
    onOpenChange(false)
    setQuery('')
    setMoved(null)
    pointer.current = null
    triggerRef.current?.focus()
  }
  const stateOf = (row: Row): TriState => {
    if (row.kind === 'all') return allState ?? (count === 0 ? 'checked' : 'unchecked')
    return row.option.state ?? (chosen.has(row.option.id) ? 'checked' : 'unchecked')
  }
  // The list's own limit applies to the flat lists only; a tree's owner refuses what it cannot keep.
  const blocked = (row: Row): boolean => row.kind === 'option' && !onRowToggle && full && !chosen.has(row.option.id) && row.option.free !== true
  const toggle = (row: Row) => {
    if (row.kind === 'all') onChange([])
    else if (onRowToggle) onRowToggle(row.option.id)
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
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      // A tree row opens or closes; in any other row the arrows move the caret as usual.
      const row = highlighted >= 0 ? rows[highlighted] : undefined
      const wantOpen = e.key === 'ArrowRight'
      if (row?.kind === 'option' && row.option.expanded !== undefined && row.option.expanded !== wantOpen && onExpand) {
        e.preventDefault()
        onExpand(row.option.id, wantOpen)
      }
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
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
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
          active && 'border-brand',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{summary ? summary.text : count > 0 ? t('fieldWithCount', { label, count }) : label}</span>
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
          <ul ref={listRef} id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 overflow-y-auto">
            {rows.map((row, index) => {
              const state = stateOf(row)
              const off = blocked(row)
              const level = row.kind === 'option' ? (row.option.level ?? 0) : 0
              return (
                <li
                  key={row.kind === 'all' ? 'all' : `o:${row.option.id}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={state === 'checked'}
                  aria-disabled={off || undefined}
                  aria-description={state === 'mixed' ? t('partly') : undefined}
                  data-state={state}
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
                  style={level > 0 ? { paddingInlineStart: `${0.5 + level * 1.25}rem` } : undefined}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-control px-2 py-2 text-sm text-ink',
                    index === highlighted && 'bg-canvas',
                    off && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {tree &&
                    (row.kind === 'option' && row.option.expanded !== undefined ? (
                      <span
                        aria-hidden
                        // The arrow opens or closes the row without ticking it.
                        onClick={(e) => {
                          e.stopPropagation()
                          onExpand?.(row.option.id, row.option.expanded !== true)
                        }}
                        className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-ink-muted"
                      >
                        <ChevronDownIcon className={cn('size-4 transition-transform', row.option.expanded !== true && '-rotate-90')} />
                      </span>
                    ) : (
                      <span aria-hidden className="mt-0.5 size-4 shrink-0" />
                    ))}
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                      state === 'unchecked' ? 'border-line bg-surface' : 'border-brand bg-brand text-ink',
                    )}
                  >
                    {state === 'checked' && <CheckIcon className="size-3" strokeWidth={3} />}
                    {state === 'mixed' && <MinusIcon className="size-3" strokeWidth={3} />}
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
