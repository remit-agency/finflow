'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { EyeOff, Plus, X } from 'lucide-react'
import { TagDot } from '@/components/tags/TagDot'
import { Input } from '@/components/ui/input'
import { pickableTags, tagByName } from '@/lib/domain/tags/search'
import { MAX_TX_TAGS, type Tag } from '@/lib/domain/tags/types'
import { cn } from '@/lib/utils'

const MAX_OPTIONS = 50

interface Props {
  id?: string
  /** The company's tags (archived ones too: a chosen archived tag still shows as a chip). */
  tags: Tag[]
  /** The chosen tag ids, in order. */
  value: string[]
  onChange: (ids: string[]) => void
  /** How many may be chosen. */
  max?: number
  /** Offer archived tags too (taking tags off in the journal). */
  includeArchived?: boolean
  /** Offer only these ids (the tags the selected operations have). */
  only?: readonly string[]
  /** When given, a name no tag has can be created; resolves to the new (or the existing) tag id, or null when it failed. */
  onCreate?: (name: string) => Promise<string | null>
  disabled?: boolean
}

type Row = { kind: 'tag'; tag: Tag } | { kind: 'create'; name: string }

/**
 * The highlighted row of the open list, or -1 for none. `moved` is the row the person moved the highlight to (arrows or
 * a real pointer move), or null while they have not. With a typed query the first row is highlighted; without one
 * nothing is, so Enter right after Tab (the list opens on focus) cannot choose a tag by accident. A moved highlight is
 * clamped, because a narrower query can shorten the list under it.
 */
function highlightedRow(count: number, query: string, moved: number | null): number {
  if (count === 0) return -1
  if (moved !== null) return Math.min(moved, count - 1)
  return query !== '' ? 0 : -1
}

/** A multiple choice of tags: the chosen ones as chips, a searchable list, and «Створити «…»» when allowed. */
export function TagPicker({ id, tags, value, onChange, max = MAX_TX_TAGS, includeArchived = false, only, onCreate, disabled }: Props) {
  const t = useTranslations('settings.tags.picker')
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // The row the person moved the highlight to; null until they do.
  const [moved, setMoved] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  // Where the pointer was when it last entered or moved over an option. The list can open under a resting pointer, and
  // the browser then reports the pointer entering the option below it: only a real move may move the highlight.
  const pointer = useRef<string | null>(null)

  const byId = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])
  const offered = useMemo(() => {
    const pool = only === undefined ? tags : tags.filter((tag) => only.includes(tag.id))
    return pickableTags(pool, query, value, { includeArchived }).slice(0, MAX_OPTIONS)
  }, [tags, only, query, value, includeArchived])
  const full = value.length >= max
  const typed = query.replace(/\s+/g, ' ').trim()
  const canCreate = onCreate !== undefined && typed !== '' && tagByName(tags, typed) === undefined
  const create: Row[] = canCreate ? [{ kind: 'create', name: typed }] : []
  const rows: Row[] = [...offered.map((tag): Row => ({ kind: 'tag', tag })), ...create]
  const highlighted = highlightedRow(rows.length, query, moved)

  const close = () => {
    setOpen(false)
    setQuery('')
    setMoved(null)
    pointer.current = null
  }

  const choose = async (row: Row) => {
    if (row.kind === 'tag') {
      onChange([...value, row.tag.id])
      setQuery('')
      setMoved(null)
      return
    }
    if (!onCreate || creating) return
    setCreating(true)
    try {
      const created = await onCreate(row.name)
      if (created !== null && !value.includes(created)) onChange([...value, created])
      setQuery('')
      setMoved(null)
    } finally {
      setCreating(false)
    }
  }

  const remove = (tagId: string) => onChange(value.filter((x) => x !== tagId))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else if (rows.length > 0) setMoved(Math.min(highlighted + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open && rows.length > 0) setMoved(Math.max(highlighted - 1, 0))
    } else if (e.key === 'Enter' && open) {
      // On the open list Enter never submits the form: it chooses the highlighted row, or closes the list when none is.
      e.preventDefault()
      if (highlighted >= 0) void choose(rows[highlighted])
      else close()
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      // Closing the list must not also close the dialog around it.
      e.stopPropagation()
      close()
    } else if (e.key === 'Backspace' && query === '' && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('label')}>
          {value.map((tagId) => {
            const tag = byId.get(tagId)
            if (!tag) return null
            return (
              <li
                key={tagId}
                data-testid="tag-picked"
                className={cn('inline-flex h-7 max-w-full items-center gap-1.5 rounded-control border border-line bg-canvas pr-1 pl-2 text-sm', tag.archived ? 'text-ink-muted' : 'text-ink')}
              >
                <TagDot color={tag.color} />
                <span className="max-w-40 truncate">{tag.name}</span>
                {tag.excludeFromAnalytics && (
                  <>
                    <EyeOff className="size-3.5 text-ink-muted" aria-hidden />
                    <span className="sr-only">{t('excluded')}</span>
                  </>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(tagId)}
                  aria-label={t('remove', { name: tag.name })}
                  className="flex size-5 items-center justify-center rounded-[4px] text-ink-muted hover:bg-line hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-soft-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={open && !full}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && !full && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          aria-label={t('label')}
          placeholder={full ? t('full', { max }) : t('placeholder')}
          disabled={disabled || full || creating}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Typing highlights the first match again.
            setMoved(null)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        {open && !full && (
          <ul
            id={listId}
            role="listbox"
            aria-label={t('label')}
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-panel"
          >
            {rows.map((row, index) => (
              <li
                key={row.kind === 'tag' ? row.tag.id : 'create'}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                // mousedown (not click) so the input's blur does not close the list before the choice is made.
                onMouseDown={(e) => {
                  e.preventDefault()
                  void choose(row)
                }}
                onMouseEnter={(e) => {
                  pointer.current = `${e.screenX},${e.screenY}`
                }}
                onMouseMove={(e) => {
                  const at = `${e.screenX},${e.screenY}`
                  if (at === pointer.current) return
                  pointer.current = at
                  setMoved(index)
                }}
                className={cn('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', index === highlighted && 'bg-canvas')}
              >
                {row.kind === 'tag' ? (
                  <>
                    <TagDot color={row.tag.color} />
                    <span className={cn('min-w-0 flex-1 truncate', row.tag.archived && 'text-ink-muted')}>{row.tag.name}</span>
                    {row.tag.excludeFromAnalytics && <span className="text-xs text-ink-muted">{t('excluded')}</span>}
                  </>
                ) : (
                  <>
                    <Plus className="size-4" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{t('create', { name: row.name })}</span>
                  </>
                )}
              </li>
            ))}
            {rows.length === 0 && (
              <li role="presentation" className="px-3 py-2 text-sm text-ink-muted">
                {t('noMatches')}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
