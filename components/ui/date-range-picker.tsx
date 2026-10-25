"use client"

// FinFlow (S01A): hand-written date range picker (no dependency). One month, Monday first,
// month and weekday names from Intl in the UI language; the first click sets the start, the second
// the end (with a hover/focus preview in between), the apply button hands the range over. Dates
// are UTC calendar days (00:00 UTC), like the app's day grouping; the helpers live in
// lib/utils/calendar-grid.ts (unit-tested).
// Keyboard: the grid is one Tab stop (roving tabindex); arrows move by a day / a week, Home/End to
// the start/end of the week, PageUp/PageDown by a month (Shift: by a year), Enter/Space choose.
import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { useFormatters } from "@/lib/i18n/useFormatters"
import { cn } from "@/lib/utils"
import {
  addDaysUtc,
  addMonthsUtc,
  buildMonthGrid,
  formatDayLongUtc,
  formatMonthTitle,
  isDayBetweenUtc,
  isSameDayUtc,
  isSameMonthUtc,
  shiftMonth,
  startOfDayUtc,
  startOfWeekUtc,
  utcDay,
  weekdayHeaders,
  weekdayMonFirst,
  type YearMonth,
} from "@/lib/utils/calendar-grid"
import { formatPeriodDay } from "@/lib/utils/period"

export interface DateRangePickerProps {
  /** The range to start from (a custom period being edited), any time of day. */
  initialStart?: Date | null
  initialEnd?: Date | null
  /** "Today", Warsaw's date (`todayUtcDay()`); its UTC day is marked and shown first when there is no initial range. */
  today: Date
  onApply: (start: Date, end: Date) => void
  onCancel: () => void
  /** Receives the day button that holds the grid's Tab stop (for the popover's initial focus). */
  focusTargetRef?: React.RefObject<HTMLButtonElement | null>
  className?: string
}

function monthOf(date: Date): YearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

function DateRangePicker({
  initialStart = null,
  initialEnd = null,
  today,
  onApply,
  onCancel,
  focusTargetRef,
  className,
}: DateRangePickerProps) {
  const t = useTranslations("periods.picker")
  const tCommon = useTranslations("common")
  const { locale } = useFormatters()
  const headers = React.useMemo(() => weekdayHeaders(locale), [locale])
  const titleId = React.useId()
  const statusId = React.useId()
  const todayDay = startOfDayUtc(today)
  const [start, setStart] = React.useState<Date | null>(() =>
    initialStart && initialEnd ? startOfDayUtc(initialStart < initialEnd ? initialStart : initialEnd) : null
  )
  const [end, setEnd] = React.useState<Date | null>(() =>
    initialStart && initialEnd ? startOfDayUtc(initialStart < initialEnd ? initialEnd : initialStart) : null
  )
  const [hover, setHover] = React.useState<Date | null>(null)
  const [focused, setFocused] = React.useState<Date>(() => start ?? todayDay)
  const [visible, setVisible] = React.useState<YearMonth>(() => monthOf(start ?? todayDay))
  const gridRef = React.useRef<HTMLTableElement>(null)
  // Set by the keyboard handler: after the next render, move DOM focus to the new Tab stop.
  const focusPending = React.useRef(false)

  React.useEffect(() => {
    if (!focusPending.current) return
    focusPending.current = false
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
  })

  const weeks = buildMonthGrid(visible)
  // The Tab stop: the focused day when it is in the shown month, else the start, today or the 1st.
  const tabStop = [focused, start, todayDay].find((d): d is Date => !!d && isSameMonthUtc(d, visible))
    ?? utcDay(visible.year, visible.month, 1)

  // While only the start is chosen, the hovered (or focused) day previews the end.
  const previewEnd = start && !end ? hover : null
  const rangeA = start
  const rangeB = end ?? previewEnd ?? start

  function choose(day: Date) {
    if (!start || end) {
      setStart(day)
      setEnd(null)
    } else if (day.getTime() < start.getTime()) {
      setEnd(start)
      setStart(day)
    } else {
      setEnd(day)
    }
    setFocused(day)
    setHover(day)
  }

  function moveFocus(next: Date) {
    setFocused(next)
    setHover(next)
    if (!isSameMonthUtc(next, visible)) setVisible(monthOf(next))
    focusPending.current = true
  }

  function onDayKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, day: Date) {
    let next: Date | null = null
    switch (event.key) {
      case "ArrowLeft": next = addDaysUtc(day, -1); break
      case "ArrowRight": next = addDaysUtc(day, 1); break
      case "ArrowUp": next = addDaysUtc(day, -7); break
      case "ArrowDown": next = addDaysUtc(day, 7); break
      case "Home": next = startOfWeekUtc(day); break
      case "End": next = addDaysUtc(startOfWeekUtc(day), 6); break
      case "PageUp": next = addMonthsUtc(day, event.shiftKey ? -12 : -1); break
      case "PageDown": next = addMonthsUtc(day, event.shiftKey ? 12 : 1); break
    }
    if (!next) return
    event.preventDefault()
    moveFocus(next)
  }

  function showMonth(delta: number) {
    setVisible((v) => shiftMonth(v, delta))
  }

  const status = !start
    ? t("chooseFirst")
    : !end
      ? t("startChosen", { date: formatPeriodDay(start, locale) })
      : `${formatPeriodDay(start, locale)} – ${formatPeriodDay(end, locale)}`

  return (
    <div data-slot="date-range-picker" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={t("prevMonth")}
          onClick={() => showMonth(-1)}
          className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-soft-foreground sm:size-9"
        >
          <ChevronLeftIcon className="size-5" aria-hidden />
        </button>
        <h2 id={titleId} aria-live="polite" className="text-[15px] font-semibold text-ink">
          {formatMonthTitle(visible, locale)}
        </h2>
        <button
          type="button"
          aria-label={t("nextMonth")}
          onClick={() => showMonth(1)}
          className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-soft-foreground sm:size-9"
        >
          <ChevronRightIcon className="size-5" aria-hidden />
        </button>
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        className="border-separate border-spacing-y-1"
        onMouseLeave={() => setHover(null)}
      >
        <thead>
          <tr>
            {headers.map(({ short, full }, i) => (
              <th
                key={i}
                scope="col"
                abbr={full}
                className="h-8 w-11 text-center text-xs font-semibold text-ink-muted sm:w-10"
              >
                {short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date.toISOString()}>
              {week.map(({ date, inMonth }) => {
                if (!inMonth) return <td key={date.toISOString()} className="p-0" />
                const inRange = !!rangeA && !!rangeB && isDayBetweenUtc(date, rangeA, rangeB)
                const lo = rangeA && rangeB ? (rangeA < rangeB ? rangeA : rangeB) : null
                const hi = rangeA && rangeB ? (rangeA < rangeB ? rangeB : rangeA) : null
                const isLo = !!lo && isSameDayUtc(date, lo)
                const isHi = !!hi && isSameDayUtc(date, hi)
                const isEdge = isLo || isHi
                const committed = !!start && !!end && isDayBetweenUtc(date, start, end)
                const isToday = isSameDayUtc(date, todayDay)
                const isTabStop = isSameDayUtc(date, tabStop)
                const weekday = weekdayMonFirst(date)
                return (
                  <td
                    key={date.toISOString()}
                    aria-selected={committed || (!!start && !end && isSameDayUtc(date, start))}
                    className={cn(
                      "p-0",
                      inRange && "bg-brand-soft",
                      inRange && (isLo || weekday === 0) && "rounded-l-control",
                      inRange && (isHi || weekday === 6) && "rounded-r-control"
                    )}
                  >
                    <button
                      ref={isTabStop ? focusTargetRef : undefined}
                      type="button"
                      tabIndex={isTabStop ? 0 : -1}
                      aria-label={formatDayLongUtc(date, locale)}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => choose(date)}
                      onKeyDown={(e) => onDayKeyDown(e, date)}
                      onMouseEnter={() => setHover(date)}
                      onFocus={() => setHover(date)}
                      className={cn(
                        "flex size-11 items-center justify-center rounded-control text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-soft-foreground sm:size-10",
                        isEdge
                          ? "bg-brand font-semibold text-ink"
                          : inRange
                            ? "text-ink hover:bg-brand-soft-hover"
                            : "text-ink hover:bg-canvas",
                        isToday && !isEdge && "font-bold text-brand-soft-foreground underline underline-offset-4"
                      )}
                    >
                      {date.getUTCDate()}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p id={statusId} aria-live="polite" className="min-h-5 text-sm text-ink-muted tabular-nums">
        {status}
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-11 px-4 text-sm sm:h-10" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
        <Button
          type="button"
          className="h-11 px-4 text-sm font-semibold sm:h-10"
          disabled={!start || !end}
          onClick={() => {
            if (start && end) onApply(start, end)
          }}
        >
          {t("apply")}
        </Button>
      </div>
    </div>
  )
}

export { DateRangePicker }
