'use client'

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
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex w-full gap-0.5 rounded-control border border-input bg-muted p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
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
