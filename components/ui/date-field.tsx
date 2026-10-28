'use client'

import { useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatDayText, maskDayText, parseDayText } from '@/lib/utils/date-text'

interface Props {
  id: string
  /** A `YYYY-MM-DD` day key, or '' while nothing valid is entered. */
  value: string
  onChange: (day: string) => void
  placeholder: string
  calendarLabel: string
}

/**
 * A day field you can type into (DD.MM.YYYY, dots appear by themselves) or pick from the calendar button.
 * `onChange` gets a day key only for a real date and '' otherwise, so the form's own validation reports the rest.
 */
export function DateField({ id, value, onChange, placeholder, calendarLabel }: Props) {
  // The text is kept as typed (also when incomplete) until it stops matching `value` (calendar pick, form following another date).
  const [draft, setDraft] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const focusedByClick = useRef(false)
  const shown = draft !== null && (parseDayText(draft) ?? '') === value ? draft : formatDayText(value)

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={shown}
        className="pr-9"
        onFocus={(e) => {
          // A prefilled date is replaced by typing instead of being appended to.
          e.currentTarget.select()
          focusedByClick.current = true
        }}
        // The mouse-up that ends the focusing click would otherwise drop the selection again.
        onMouseUp={(e) => {
          if (focusedByClick.current) e.preventDefault()
          focusedByClick.current = false
        }}
        onChange={(e) => {
          const text = maskDayText(e.target.value)
          setDraft(text)
          onChange(parseDayText(text) ?? '')
        }}
      />
      <button
        type="button"
        aria-label={calendarLabel}
        onClick={() => picker.current?.showPicker?.()}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-muted hover:text-ink"
      >
        <CalendarDays className="size-4" aria-hidden />
      </button>
      {/* The native picker only supplies the calendar; the text field above is the one that is read and labelled. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        onChange={(e) => {
          setDraft(null)
          onChange(e.target.value)
        }}
        className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
      />
    </div>
  )
}
