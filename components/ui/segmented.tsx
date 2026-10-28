'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
}

interface Props<V extends string> {
  value: V
  onChange: (value: V) => void
  options: SegmentedOption<V>[]
  /** The accessible name of the group. */
  label: string
  className?: string
}

/** A short single choice shown as joined buttons (a radio group with the look of a toggle). */
export function Segmented<V extends string>({ value, onChange, options, label, className }: Props<V>) {
  const buttons = useRef(new Map<V, HTMLButtonElement>())

  // Only one option is a tab stop: the checked one, or the first enabled one when none is checked.
  const checked = options.find((o) => o.value === value && !o.disabled)
  const tabStop = (checked ?? options.find((o) => !o.disabled))?.value

  /** Arrow keys move to the neighbouring enabled option, select it and focus it (the radio group pattern). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    for (let i = 1; i < options.length; i++) {
      const next = options[(index + step * i + options.length * i) % options.length]
      if (next.disabled) continue
      onChange(next.value)
      buttons.current.get(next.value)?.focus()
      return
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex w-full gap-0.5 rounded-control border border-input bg-muted p-0.5', className)}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) buttons.current.set(option.value, node)
              else buttons.current.delete(option.value)
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={option.value === tabStop ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'h-8 flex-1 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
              active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
