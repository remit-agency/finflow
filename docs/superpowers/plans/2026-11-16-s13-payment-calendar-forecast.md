# S13 Payment Calendar, Forecast and Cash Gap Signal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old browser-side calendar with a server-computed payment calendar (month grid + balance chart), add a 90-day balance forecast, and show a cash gap banner (date and amount) in the journal and on the calendar when the forecast balance falls below a per-company minimum.

**Architecture:** One pure forecast function (`lib/domain/forecast`) fed by server reads (`lib/server/forecast`): account balances now, planned operations (overdue counted as due today) up to +90 days, and the latest NBP rate for foreign currencies. Three read-only routes (`/forecast`, `/calendar`, `/calendar/day`) and one new company field `cashMinimumMinor` saved through the existing `PATCH /api/orgs/{orgId}`. No new collections, no new indexes, no rules change.

**Tech Stack:** Next.js 16, React 19, TypeScript, next-intl (uk/pl/en, identical keys), Firestore Admin, Vitest (unit and emulator integration), Playwright e2e on the Firestore emulator, recharts.

**Spec:** `docs/superpowers/specs/2026-11-16-s13-payment-calendar-forecast-design.md` (read it first).

## Ground rules for every task

- Work on branch `s13-calendar-forecast` (already exists). Commit after each task with a Conventional Commit subject. End commit messages with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Code comments and identifiers in English. Messages in uk, pl, en must have the same keys.
- `tsconfig` targets ES2017: use `BigInt(...)`, no bigint literals. Vitest does not typecheck: always run `npm run typecheck`.
- Money is integer minor units. Days are `YYYY-MM-DD` strings (UTC days; "today" is the Warsaw day from `deps.today()` on the server and `todayDay()` in the browser).
- Never kill `node` by image name. Do not use junctions with `git worktree remove`.
- Integration tests: `export PATH="$HOME/.jre/temurin-21/bin:$PATH"; npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts <file>"`.
- e2e: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test <files>"`. Avoid quoted `-g` patterns.
- Write files with the Write tool or a node script, not bash heredocs with apostrophes.
- Unit tests: `npx vitest run <path>`.

## File structure

**Create**
- `lib/domain/forecast/types.ts` — constants and the `Forecast`, `CashGap`, `CalendarMonth`, `DayPayments` types.
- `lib/domain/forecast/build.ts` — pure `buildForecast`.
- `lib/domain/forecast/calendar.ts` — pure `buildCalendarMonth`.
- `lib/domain/forecast/query.ts` — `parseCalendarQuery`, `parseDayQuery`, `parseCashMinimum`.
- `lib/server/forecast/read.ts` — `readForecast`, `readCalendarMonth`, `readCalendarDay`.
- `lib/server/forecast/index.ts` — `forecast` facade bound to production deps.
- `app/api/orgs/[orgId]/forecast/route.ts`, `app/api/orgs/[orgId]/calendar/route.ts`, `app/api/orgs/[orgId]/calendar/day/route.ts`.
- `lib/api/forecast-client.ts` — fetchers.
- `lib/hooks/useForecast.ts`, `lib/hooks/useCalendarMonth.ts`, `lib/hooks/useCalendarDay.ts`.
- `components/forecast/CashGapBanner.tsx`, `CalendarGrid.tsx`, `CalendarChart.tsx`, `DayPanel.tsx`.
- Tests: `tests/unit/domain/forecast/{build,calendar,query}.test.ts`, `tests/integration/forecast-read.test.ts`, `tests/e2e/forecast.spec.ts`.

**Modify**
- `lib/domain/ledger/entity-input.ts` (`OrgPatch`, `parseOrgPatch`), `lib/server/ledger/org.ts`, `lib/api/ledger-client.ts` (`updateOrganization`), `types/index.ts` (`Organization`), `lib/firebase/firestore.ts` (org mapping), `lib/server/reports/read.ts` (`ReportContext.cashMinimumMinor`).
- `app/(app)/[orgSlug]/settings/company/page.tsx` (minimum field).
- `app/(app)/[orgSlug]/transactions/page.tsx` (banner), `app/(app)/[orgSlug]/analytics/calendar/page.tsx` (rewrite).
- `messages/uk.json`, `messages/pl.json`, `messages/en.json`.
- `tests/e2e/analytics-filters.spec.ts`, `tests/e2e/api-guards.spec.ts`, `tests/ui-shots/shots.spec.ts`.
- `CLAUDE.md`, `PROGRESS.md`.

**Delete (Task 10)**
- `components/charts/CalendarView.tsx`, `buildCalendar` and `DayData`/`CalendarReport` in `lib/utils/analytics.ts`, their tests in `tests/unit/utils/analytics.test.ts`.

---

### Task 1: Forecast types and the pure `buildForecast`

**Files:**
- Create: `lib/domain/forecast/types.ts`, `lib/domain/forecast/build.ts`
- Test: `tests/unit/domain/forecast/build.test.ts`

- [ ] **Step 1: Write the types**

Create `lib/domain/forecast/types.ts`:

```ts
import type { PlannedRow } from '@/lib/domain/recurring/types'

/** The forecast reaches this many days after today (today included as day 0). */
export const FORECAST_DAYS = 90
/** The largest planned payments of the gap day the banner may name. */
export const MAX_CAUSES = 3
/** Payments one day panel lists at most. */
export const DAY_ROWS = 100

/** One planned payment that pushes the balance down on the gap day. */
export interface GapCause {
  id: string
  type: 'income' | 'expense'
  amountMinor: number
  currency: string
  /** The amount in the company currency (the latest NBP rate for another currency). */
  baseMinor: number
  /** The series name, else the comment; null when the payment has neither. */
  label: string | null
}

export interface ForecastDay {
  date: string
  plannedIncomeBase: number
  plannedExpenseBase: number
  /** The forecast total of every account in the company currency at the close of the day. */
  endBalanceBase: number
}

/** The first day the forecast total is below the company minimum. */
export interface CashGap {
  date: string
  balanceBase: number
  minimumBase: number
  /** `minimumBase - balanceBase`, always positive. */
  shortfallBase: number
  /** The largest planned expenses of that day (at most MAX_CAUSES), largest first; empty when none is planned that day. */
  causes: GapCause[]
}

export interface Forecast {
  /** The Warsaw day the forecast starts on. */
  today: string
  currency: string
  minimumBase: number
  /** The total of the valued accounts now. */
  startBase: number
  /** FORECAST_DAYS + 1 days, from today. */
  days: ForecastDay[]
  gap: CashGap | null
  /** The day of the lowest forecast balance (the first one on a tie). */
  lowest: { date: string; balanceBase: number }
  /** A foreign-currency account or payment was converted at the latest NBP rate. */
  approximate: boolean
  /** Accounts or planned payments left out because no rate was available. */
  unvalued: number
  /** A planned-payments read stopped at its limit: the forecast may be incomplete. */
  truncated: boolean
}

/** One day of a payment calendar month. */
export interface CalendarDay {
  date: string
  kind: 'past' | 'today' | 'future'
  /** What happened (income and expense counted in analytics, in the company currency). */
  incomeBase: number
  expenseBase: number
  /** What is planned that day (transfers left out). */
  plannedIncomeBase: number
  plannedExpenseBase: number
  /** Planned payments dated before today (still unpaid). */
  overdueCount: number
  /** Past days: the real total at the close; today and the next FORECAST_DAYS: the forecast; later: null. */
  endBalanceBase: number | null
  /** The forecast total is below the minimum on this day. */
  belowMinimum: boolean
  /** The first day of the cash gap. */
  gap: boolean
}

export interface CalendarMonth {
  year: number
  /** 1-12. */
  month: number
  today: string
  currency: string
  minimumBase: number
  days: CalendarDay[]
  gapDate: string | null
  approximate: boolean
  unvalued: number
  truncated: boolean
}

/** One operation of a day, as the day panel lists it. */
export interface DayActual {
  id: string
  type: 'income' | 'expense' | 'transfer'
  accountId: string
  amountMinor: number
  currency: string
  description?: string
}

export interface DayPayments {
  date: string
  /** Planned operations of the day (the rows the plan actions take). */
  planned: PlannedRow[]
  actual: DayActual[]
  /** The series names of the planned rows. */
  names: Record<string, string>
  /** More operations exist than DAY_ROWS. */
  truncated: boolean
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/domain/forecast/build.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildForecast, type ForecastInput } from '@/lib/domain/forecast/build'
import { FORECAST_DAYS } from '@/lib/domain/forecast/types'
import type { PlannedRow } from '@/lib/domain/recurring/types'

const TODAY = '2026-11-16'

const row = (id: string, paymentDate: string, amountMinor: number, type: PlannedRow['type'] = 'expense', over: Partial<PlannedRow> = {}): PlannedRow => ({
  id,
  type,
  accountId: 'a1',
  amountMinor,
  currency: 'PLN',
  paymentDate,
  estimated: false,
  manual: false,
  ...over,
})

const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  today: TODAY,
  baseCurrency: 'PLN',
  minimumMinor: 0,
  startBase: 100_000,
  startIncomplete: false,
  foreignAccounts: false,
  planned: [],
  rates: new Map(),
  names: {},
  truncated: false,
  ...over,
})

describe('buildForecast', () => {
  it('starts from the balance now and adds the planned payments by day', () => {
    const f = buildForecast(input({ planned: [row('p1', '2026-11-18', 30_000), row('p2', '2026-11-20', 50_000, 'income')] }))
    expect(f.days).toHaveLength(FORECAST_DAYS + 1)
    expect(f.days[0]).toMatchObject({ date: TODAY, endBalanceBase: 100_000 })
    expect(f.days[2]).toMatchObject({ date: '2026-11-18', plannedExpenseBase: 30_000, endBalanceBase: 70_000 })
    expect(f.days[4]).toMatchObject({ date: '2026-11-20', plannedIncomeBase: 50_000, endBalanceBase: 120_000 })
    expect(f.days[FORECAST_DAYS].endBalanceBase).toBe(120_000)
    expect(f.gap).toBeNull()
  })

  it('counts an overdue payment as due today', () => {
    const f = buildForecast(input({ planned: [row('late', '2026-11-10', 40_000)] }))
    expect(f.days[0]).toMatchObject({ plannedExpenseBase: 40_000, endBalanceBase: 60_000 })
  })

  it('leaves own transfers out: they do not change the total', () => {
    const f = buildForecast(input({ planned: [row('t1', '2026-11-18', 90_000, 'transfer')] }))
    expect(f.days[2].endBalanceBase).toBe(100_000)
  })

  it('ignores a payment after the last forecast day', () => {
    const f = buildForecast(input({ planned: [row('far', '2027-03-01', 90_000)] }))
    expect(f.days[FORECAST_DAYS].endBalanceBase).toBe(100_000)
  })

  it('finds the first day below the minimum and names the largest expenses of that day', () => {
    const f = buildForecast(
      input({
        minimumMinor: 10_000,
        planned: [
          row('small', '2026-11-24', 5_000, 'expense', { description: 'Coffee' }),
          row('vat', '2026-11-24', 70_000, 'expense', { seriesId: 's-vat' }),
          row('zus', '2026-11-24', 30_000, 'expense', { description: 'ZUS' }),
          row('ink', '2026-11-24', 1_000),
        ],
        names: { 's-vat': 'VAT-7' },
      }),
    )
    // 100000 - 106000 = -6000 on 2026-11-24, below the minimum 10000.
    expect(f.gap).toMatchObject({ date: '2026-11-24', balanceBase: -6_000, minimumBase: 10_000, shortfallBase: 16_000 })
    expect(f.gap?.causes.map((c) => [c.id, c.label])).toEqual([
      ['vat', 'VAT-7'],
      ['zus', 'ZUS'],
      ['small', 'Coffee'],
    ])
    expect(f.lowest).toEqual({ date: '2026-11-24', balanceBase: -6_000 })
  })

  it('a balance equal to the minimum is not a gap', () => {
    const f = buildForecast(input({ minimumMinor: 70_000, planned: [row('p', '2026-11-18', 30_000)] }))
    expect(f.gap).toBeNull()
  })

  it('reports a gap today when the balance is already below the minimum, with no causes', () => {
    const f = buildForecast(input({ startBase: 500, minimumMinor: 1_000 }))
    expect(f.gap).toMatchObject({ date: TODAY, balanceBase: 500, shortfallBase: 500, causes: [] })
  })

  it('converts another currency at the given rate and marks the forecast approximate', () => {
    const f = buildForecast(
      input({
        foreignAccounts: true,
        rates: new Map([['EUR', 4.5]]),
        planned: [row('e', '2026-11-18', 10_000, 'expense', { currency: 'EUR' })],
      }),
    )
    expect(f.days[2].plannedExpenseBase).toBe(45_000)
    expect(f.approximate).toBe(true)
    expect(f.unvalued).toBe(0)
  })

  it('leaves out a payment with no rate and counts it as unvalued', () => {
    const f = buildForecast(input({ planned: [row('e', '2026-11-18', 10_000, 'expense', { currency: 'EUR' })] }))
    expect(f.days[2].plannedExpenseBase).toBe(0)
    expect(f.unvalued).toBe(1)
  })

  it('counts an incomplete start (an account without a rate) as unvalued and passes truncated on', () => {
    const f = buildForecast(input({ startIncomplete: true, truncated: true }))
    expect(f.unvalued).toBe(1)
    expect(f.truncated).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx vitest run tests/unit/domain/forecast/build.test.ts`
Expected: FAIL (module `@/lib/domain/forecast/build` not found).

- [ ] **Step 4: Write the implementation**

Create `lib/domain/forecast/build.ts`:

```ts
import { addDays } from '@/lib/domain/ledger/days'
import { mulRate } from '@/lib/domain/ledger/money'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { FORECAST_DAYS, MAX_CAUSES, type CashGap, type Forecast, type ForecastDay, type GapCause } from './types'

export interface ForecastInput {
  /** The Warsaw day. */
  today: string
  baseCurrency: string
  /** The company minimum, in the company currency. */
  minimumMinor: number
  /** The total of the valued accounts now, in the company currency. */
  startBase: number
  /** An account has no rate: its balance is not in `startBase`. */
  startIncomplete: boolean
  /** An account in another currency exists (its balance was converted). */
  foreignAccounts: boolean
  /** The overdue planned payments and those up to the last forecast day. */
  planned: readonly PlannedRow[]
  /** Currency -> the latest rate to the company currency. */
  rates: ReadonlyMap<string, number>
  /** Series id -> name. */
  names: Readonly<Record<string, string>>
  /** A planned-payments read stopped at its limit. */
  truncated: boolean
  /** Tests: another horizon. */
  days?: number
}

/** The amount in the company currency, or null when its currency has no rate. */
export function baseOf(amountMinor: number, currency: string, baseCurrency: string, rates: ReadonlyMap<string, number>): number | null {
  if (currency === baseCurrency) return amountMinor
  const rate = rates.get(currency)
  return rate === undefined ? null : mulRate(amountMinor, rate)
}

/**
 * The balance forecast (S13): today's total plus the planned payments by day. An overdue payment counts on today (the money
 * is still going to leave); an own-account transfer does not change the total; a payment after the horizon is not counted.
 * The cash gap is the first day the total is below the company minimum.
 */
export function buildForecast(input: ForecastInput): Forecast {
  const { today, baseCurrency } = input
  const horizon = input.days ?? FORECAST_DAYS
  const last = addDays(today, horizon)
  let approximate = input.foreignAccounts
  let unvalued = input.startIncomplete ? 1 : 0
  const income = new Map<string, number>()
  const expense = new Map<string, number>()
  const byDay = new Map<string, { row: PlannedRow; base: number }[]>()
  for (const row of input.planned) {
    if (row.type === 'transfer') continue
    const day = row.paymentDate < today ? today : row.paymentDate
    if (day > last) continue
    const base = baseOf(row.amountMinor, row.currency, baseCurrency, input.rates)
    if (base === null) {
      unvalued += 1
      continue
    }
    if (row.currency !== baseCurrency) approximate = true
    const sums = row.type === 'income' ? income : expense
    sums.set(day, (sums.get(day) ?? 0) + base)
    byDay.set(day, [...(byDay.get(day) ?? []), { row, base }])
  }

  const days: ForecastDay[] = []
  let balance = input.startBase
  let lowest = { date: today, balanceBase: Number.POSITIVE_INFINITY }
  let gap: CashGap | null = null
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(today, i)
    const plannedIncomeBase = income.get(date) ?? 0
    const plannedExpenseBase = expense.get(date) ?? 0
    balance += plannedIncomeBase - plannedExpenseBase
    days.push({ date, plannedIncomeBase, plannedExpenseBase, endBalanceBase: balance })
    if (balance < lowest.balanceBase) lowest = { date, balanceBase: balance }
    if (gap === null && balance < input.minimumMinor) {
      gap = { date, balanceBase: balance, minimumBase: input.minimumMinor, shortfallBase: input.minimumMinor - balance, causes: causesOf(byDay.get(date) ?? [], input.names) }
    }
  }
  return {
    today,
    currency: baseCurrency,
    minimumBase: input.minimumMinor,
    startBase: input.startBase,
    days,
    gap,
    lowest,
    approximate,
    unvalued,
    truncated: input.truncated,
  }
}

/** The largest expenses of a day, largest first (ties keep the read order). */
function causesOf(rows: readonly { row: PlannedRow; base: number }[], names: Readonly<Record<string, string>>): GapCause[] {
  return rows
    .filter(({ row }) => row.type === 'expense')
    .sort((a, b) => b.base - a.base)
    .slice(0, MAX_CAUSES)
    .map(({ row, base }) => ({
      id: row.id,
      type: 'expense' as const,
      amountMinor: row.amountMinor,
      currency: row.currency,
      baseMinor: base,
      label: (row.seriesId !== undefined ? names[row.seriesId] : undefined) ?? row.description ?? null,
    }))
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run tests/unit/domain/forecast/build.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/forecast tests/unit/domain/forecast
git commit -m "feat(forecast): the pure balance forecast and cash gap (S13)"
```

---

### Task 2: Calendar month builder and query parsing (pure)

**Files:**
- Create: `lib/domain/forecast/calendar.ts`, `lib/domain/forecast/query.ts`
- Test: `tests/unit/domain/forecast/calendar.test.ts`, `tests/unit/domain/forecast/query.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domain/forecast/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ReportError } from '@/lib/domain/reports/errors'
import { parseCalendarQuery, parseCashMinimum, parseDayQuery } from '@/lib/domain/forecast/query'

const code = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ReportError) return `${e.code}:${e.field ?? ''}`
    throw e
  }
  return 'none'
}

describe('parseCalendarQuery', () => {
  it('takes a year and a month', () => {
    expect(parseCalendarQuery(new URLSearchParams('year=2026&month=11'))).toEqual({ year: 2026, month: 11 })
  })
  it('refuses a missing, repeated or out-of-range value and unknown keys', () => {
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026')))).toBe('invalid_input:month')
    expect(code(() => parseCalendarQuery(new URLSearchParams('month=11')))).toBe('invalid_input:year')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&month=13')))).toBe('invalid_input:month')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=1999&month=1')))).toBe('invalid_input:year')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&year=2027&month=1')))).toBe('invalid_input:year')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&month=1&x=1')))).toBe('invalid_input:x')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&month=1.5')))).toBe('invalid_input:month')
  })
})

describe('parseDayQuery', () => {
  it('takes one day', () => {
    expect(parseDayQuery(new URLSearchParams('date=2026-11-24'))).toBe('2026-11-24')
  })
  it('refuses a bad day or other keys', () => {
    expect(code(() => parseDayQuery(new URLSearchParams('date=2026-13-40')))).toBe('invalid_input:date')
    expect(code(() => parseDayQuery(new URLSearchParams('')))).toBe('invalid_input:date')
    expect(code(() => parseDayQuery(new URLSearchParams('date=2026-11-24&x=1')))).toBe('invalid_input:x')
  })
})

describe('parseCashMinimum', () => {
  it('is a stored whole number of minor units, else 0 (absent means 0)', () => {
    expect(parseCashMinimum(250_000)).toBe(250_000)
    expect(parseCashMinimum(undefined)).toBe(0)
    expect(parseCashMinimum(-5)).toBe(0)
    expect(parseCashMinimum(1.5)).toBe(0)
    expect(parseCashMinimum('10')).toBe(0)
  })
})
```

Create `tests/unit/domain/forecast/calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCalendarMonth, type CalendarInput } from '@/lib/domain/forecast/calendar'
import { buildForecast } from '@/lib/domain/forecast/build'
import type { PlannedRow } from '@/lib/domain/recurring/types'

const TODAY = '2026-11-16'
const row = (id: string, paymentDate: string, amountMinor: number, type: PlannedRow['type'] = 'expense'): PlannedRow => ({
  id,
  type,
  accountId: 'a1',
  amountMinor,
  currency: 'PLN',
  paymentDate,
  estimated: false,
  manual: false,
})

function input(over: Partial<CalendarInput> = {}): CalendarInput {
  const planned = [row('p1', '2026-11-18', 30_000), row('late', '2026-11-10', 5_000)]
  const forecast = buildForecast({ today: TODAY, baseCurrency: 'PLN', minimumMinor: 80_000, startBase: 100_000, startIncomplete: false, foreignAccounts: false, planned, rates: new Map(), names: {}, truncated: false })
  return {
    year: 2026,
    month: 11,
    today: TODAY,
    currency: 'PLN',
    movement: new Map([['2026-11-02', { incomeBase: 70_000, expenseBase: 20_000 }]]),
    planned,
    rates: new Map(),
    pastBalances: new Map([['2026-11-02', 90_000], ['2026-11-15', null]]),
    forecast,
    ...over,
  }
}

describe('buildCalendarMonth', () => {
  it('has one entry per day of the month and tells past, today and future apart', () => {
    const m = buildCalendarMonth(input())
    expect(m.days).toHaveLength(30)
    expect(m.days[0].date).toBe('2026-11-01')
    expect(m.days[15]).toMatchObject({ date: '2026-11-16', kind: 'today' })
    expect(m.days[14].kind).toBe('past')
    expect(m.days[16].kind).toBe('future')
  })

  it('shows what happened, what is planned and the overdue count by day', () => {
    const m = buildCalendarMonth(input())
    expect(m.days[1]).toMatchObject({ incomeBase: 70_000, expenseBase: 20_000, plannedExpenseBase: 0 })
    expect(m.days[17]).toMatchObject({ date: '2026-11-18', plannedExpenseBase: 30_000, overdueCount: 0 })
    expect(m.days[9]).toMatchObject({ date: '2026-11-10', plannedExpenseBase: 5_000, overdueCount: 1 })
  })

  it('past days show the real balance (null when it is not valued), today and later the forecast', () => {
    const m = buildCalendarMonth(input())
    expect(m.days[1].endBalanceBase).toBe(90_000)
    expect(m.days[14].endBalanceBase).toBeNull()
    expect(m.days[15].endBalanceBase).toBe(95_000)
    expect(m.days[17].endBalanceBase).toBe(65_000)
  })

  it('marks the days below the minimum and the first one as the gap', () => {
    const m = buildCalendarMonth(input())
    expect(m.gapDate).toBe('2026-11-18')
    expect(m.days[17]).toMatchObject({ belowMinimum: true, gap: true })
    expect(m.days[18]).toMatchObject({ belowMinimum: true, gap: false })
    expect(m.days[15]).toMatchObject({ belowMinimum: false, gap: false })
  })

  it('a month past the forecast horizon has planned amounts but no balance', () => {
    const m = buildCalendarMonth(input({ year: 2027, month: 6, movement: new Map(), planned: [row('far', '2027-06-10', 12_000)], pastBalances: new Map() }))
    expect(m.days).toHaveLength(30)
    expect(m.days[9]).toMatchObject({ date: '2027-06-10', kind: 'future', plannedExpenseBase: 12_000, endBalanceBase: null, belowMinimum: false })
  })

  it('leaves transfers out and counts a payment without a rate as unvalued', () => {
    const m = buildCalendarMonth(input({ planned: [row('t', '2026-11-18', 90_000, 'transfer'), { ...row('e', '2026-11-19', 1_000), currency: 'EUR' }] }))
    expect(m.days[17].plannedExpenseBase).toBe(0)
    expect(m.unvalued).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/unit/domain/forecast`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `query.ts`**

Create `lib/domain/forecast/query.ts`:

```ts
import { isDay } from '@/lib/domain/ledger/days'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { ReportError } from '@/lib/domain/reports/errors'

function bad(field: string): never {
  throw new ReportError('invalid_input', { field })
}

function single(p: URLSearchParams, key: string): string {
  const values = p.getAll(key)
  if (values.length !== 1) bad(key)
  return values[0]
}

function wholeNumber(text: string, key: string, min: number, max: number): number {
  if (!/^\d{1,4}$/.test(text)) bad(key)
  const n = Number(text)
  if (n < min || n > max) bad(key)
  return n
}

/** `GET /calendar?year=2026&month=11` (month 1-12). */
export function parseCalendarQuery(p: URLSearchParams): { year: number; month: number } {
  for (const key of p.keys()) if (key !== 'year' && key !== 'month') bad(key)
  return { year: wholeNumber(single(p, 'year'), 'year', 2000, 2100), month: wholeNumber(single(p, 'month'), 'month', 1, 12) }
}

/** `GET /calendar/day?date=YYYY-MM-DD`. */
export function parseDayQuery(p: URLSearchParams): string {
  for (const key of p.keys()) if (key !== 'date') bad(key)
  const date = single(p, 'date')
  if (!isDay(date)) bad('date')
  return date
}

/** The stored company minimum: a whole number of minor units from 0 to MAX_MINOR; anything else (absent included) is 0. */
export function parseCashMinimum(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_MINOR ? value : 0
}
```

Note: `single` reports a missing key with the key's own name, so `year=2026` alone gives `invalid_input:month` (month is checked second) and `month=11` alone gives `invalid_input:year`. `isDay` must reject `2026-13-40` (check `lib/domain/ledger/days.ts`; if it only checks the shape, add a real calendar check there and a test for it).

- [ ] **Step 4: Write `calendar.ts`**

Create `lib/domain/forecast/calendar.ts`:

```ts
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { baseOf } from './build'
import type { CalendarDay, CalendarMonth, Forecast } from './types'

export interface CalendarInput {
  year: number
  /** 1-12. */
  month: number
  today: string
  currency: string
  /** Day -> what happened, in the company currency (the rollups of the month). */
  movement: ReadonlyMap<string, { incomeBase: number; expenseBase: number }>
  /** The planned operations dated in the month. */
  planned: readonly PlannedRow[]
  /** Currency -> the latest rate to the company currency. */
  rates: ReadonlyMap<string, number>
  /** Day -> the real total at the close (null: an account has no rate). Days up to today only. */
  pastBalances: ReadonlyMap<string, number | null>
  forecast: Forecast
}

const pad = (n: number): string => String(n).padStart(2, '0')

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * One month of the payment calendar (S13): what happened, what is planned, the end-of-day balance (the real one up to
 * yesterday, the forecast from today to the end of the forecast, none after it) and the cash gap day.
 */
export function buildCalendarMonth(input: CalendarInput): CalendarMonth {
  const { year, month, today, forecast } = input
  const plannedIncome = new Map<string, number>()
  const plannedExpense = new Map<string, number>()
  const overdue = new Map<string, number>()
  let unvalued = forecast.unvalued
  let approximate = forecast.approximate
  for (const row of input.planned) {
    if (row.type === 'transfer') continue
    const base = baseOf(row.amountMinor, row.currency, input.currency, input.rates)
    if (base === null) {
      unvalued += 1
      continue
    }
    if (row.currency !== input.currency) approximate = true
    const sums = row.type === 'income' ? plannedIncome : plannedExpense
    sums.set(row.paymentDate, (sums.get(row.paymentDate) ?? 0) + base)
    if (row.paymentDate < today) overdue.set(row.paymentDate, (overdue.get(row.paymentDate) ?? 0) + 1)
  }
  const forecastByDay = new Map(forecast.days.map((d) => [d.date, d]))
  const days: CalendarDay[] = []
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`
    const kind = date < today ? 'past' : date === today ? 'today' : 'future'
    const moved = input.movement.get(date)
    const fd = forecastByDay.get(date)
    const endBalanceBase = kind === 'past' ? (input.pastBalances.get(date) ?? null) : (fd?.endBalanceBase ?? null)
    days.push({
      date,
      kind,
      incomeBase: moved?.incomeBase ?? 0,
      expenseBase: moved?.expenseBase ?? 0,
      plannedIncomeBase: plannedIncome.get(date) ?? 0,
      plannedExpenseBase: plannedExpense.get(date) ?? 0,
      overdueCount: overdue.get(date) ?? 0,
      endBalanceBase,
      belowMinimum: kind !== 'past' && endBalanceBase !== null && endBalanceBase < forecast.minimumBase,
      gap: forecast.gap?.date === date,
    })
  }
  return {
    year,
    month,
    today,
    currency: input.currency,
    minimumBase: forecast.minimumBase,
    days,
    gapDate: forecast.gap?.date ?? null,
    approximate,
    unvalued,
    truncated: forecast.truncated,
  }
}

/** The first and last day of a month. */
export function monthRange(year: number, month: number): { first: string; last: string } {
  return { first: `${year}-${pad(month)}-01`, last: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}` }
}
```


- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/domain/forecast && npm run typecheck`
Expected: PASS. If the "unvalued" test fails because `forecast.unvalued` already counted the EUR payment, the assertion `toBeGreaterThanOrEqual(1)` still holds; fix real failures only.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/forecast tests/unit/domain/forecast
git commit -m "feat(forecast): calendar month builder and query parsing (S13)"
```

---

### Task 3: Company minimum: data path (domain, server, client types)

**Files:**
- Modify: `lib/domain/ledger/entity-input.ts`, `lib/server/ledger/org.ts`, `lib/api/ledger-client.ts`, `types/index.ts`, `lib/firebase/firestore.ts`, `lib/server/reports/read.ts`
- Test: `tests/unit/domain/ledger/entity-input.test.ts` (find the existing file with `grep -rn parseOrgPatch tests`), `tests/integration/ledger-accounts.test.ts` (the existing org tests)

- [ ] **Step 1: Write failing tests**

Find the existing `parseOrgPatch` tests (`grep -rn "parseOrgPatch" tests`) and add:

```ts
it('takes the cash minimum as a whole number of minor units from 0', () => {
  expect(parseOrgPatch({ cashMinimumMinor: 250_000 })).toEqual({ cashMinimumMinor: 250_000 })
  expect(parseOrgPatch({ name: 'Acme', cashMinimumMinor: 0 })).toEqual({ name: 'Acme', cashMinimumMinor: 0 })
})

it('refuses a negative, fractional, huge or non-number cash minimum', () => {
  for (const bad of [-1, 1.5, 10 ** 13 + 1, '100', null]) {
    expect(() => parseOrgPatch({ cashMinimumMinor: bad })).toThrow()
  }
})
```

In the existing integration test file for `updateOrganization` (`tests/integration/ledger-accounts.test.ts`), add a test that `updateOrganization(deps, ORG, UID, { cashMinimumMinor: 250_000 })` returns `{ name: 'Acme', currency: 'PLN', cashMinimumMinor: 250_000 }`, stores the field, writes an `org.update` audit document whose `before` has `cashMinimumMinor: 0` and `after` has `250_000`, and that a patch with only `name` keeps the stored minimum. Update the other assertions in that file that compare the returned object with `toEqual({ name, currency })` to include `cashMinimumMinor: 0`.

- [ ] **Step 2: Run and see failures**

Run: `npx vitest run tests/unit/domain/ledger` (the entity-input test) and the integration command for `tests/integration/ledger-accounts.test.ts`.
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/domain/ledger/entity-input.ts`:

```ts
export interface OrgPatch {
  name?: string
  currency?: string
  /** The company minimum balance the cash gap warning compares with, minor units of the company currency. */
  cashMinimumMinor?: number
}
```

and in `parseOrgPatch`:

```ts
onlyKeys(r, ['name', 'currency', 'cashMinimumMinor'])
if (r.name === undefined && r.currency === undefined && r.cashMinimumMinor === undefined) bad('body')
// ... existing name and currency handling ...
if (r.cashMinimumMinor !== undefined) {
  if (typeof r.cashMinimumMinor !== 'number' || !Number.isInteger(r.cashMinimumMinor) || r.cashMinimumMinor < 0 || r.cashMinimumMinor > MAX_MINOR) bad('cashMinimumMinor')
  out.cashMinimumMinor = r.cashMinimumMinor
}
```

(import `MAX_MINOR` from `@/lib/domain/ledger/money`).

`lib/server/ledger/org.ts`: read the stored value with `parseCashMinimum(snap.get('cashMinimumMinor'))` (from `@/lib/domain/forecast/query`), build `before` and `after` with `cashMinimumMinor`, return `{ name, currency, cashMinimumMinor }`, and `t.update(ref, after)` writes it (the field is created on the first save). Keep the `currency_locked` check unchanged. Update the return type.

`types/index.ts`: add `cashMinimumMinor: number` to `Organization`. `lib/firebase/firestore.ts` mapping: `cashMinimumMinor: parseCashMinimum(data.cashMinimumMinor)` (import from `@/lib/domain/forecast/query`; it is a pure module). Fix every place that builds an `Organization` literal (typecheck lists them; add `cashMinimumMinor: 0`).

`lib/api/ledger-client.ts` `updateOrganization`: widen the patch type to `{ name?: string; currency?: string; cashMinimumMinor?: number }`.

`lib/server/reports/read.ts`: add `cashMinimumMinor: number` to `ReportContext` and set it in `readContext`: `cashMinimumMinor: parseCashMinimum(org.get('cashMinimumMinor'))`. Fix test fixtures that build a `ReportContext` (typecheck lists them).

- [ ] **Step 4: Run the tests and typecheck**

Run the unit and integration commands again, then `npm run typecheck`.
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(org): a company cash minimum (cashMinimumMinor) saved through PATCH /orgs (S13)"
```

---

### Task 4: Server reads (`readForecast`, `readCalendarMonth`, `readCalendarDay`)

**Files:**
- Create: `lib/server/forecast/read.ts`, `lib/server/forecast/index.ts`
- Modify: none (it imports exported helpers; if `ROW_FIELDS`, `PLANNED_SCAN`, `cellsQuery`, `readContext`, `overdueQuery` are not exported, export them)
- Test: `tests/integration/forecast-read.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/forecast-read.test.ts`. Use the helpers of `tests/integration/helpers.ts` (`makeDeps`, `seedOrg`, `seedAccount`, `ORG`, `UID`, `clearFirestore`, `testDb`) and `createTransaction` plus `parseTransactionInput` as `recurring-read.test.ts` does. TODAY in `makeDeps` is `2026-10-27`; use `makeDeps(db, { today: () => '2026-10-27' })` explicitly. Cases:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { FORECAST_DAYS } from '@/lib/domain/forecast/types'
import { createTransaction } from '@/lib/server/ledger/write'
import { readCalendarDay, readCalendarMonth, readForecast } from '@/lib/server/forecast/read'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db, { today: () => '2026-10-27' })

async function planned(paymentDate: string, type: 'income' | 'expense', amountMinor: number, accountId = 'pln', description?: string) {
  return createTransaction(deps, ORG, UID, parseTransactionInput({ type, status: 'planned', accountId, amountMinor, paymentDate, description }))
}
async function actual(paymentDate: string, type: 'income' | 'expense', amountMinor: number, accountId = 'pln') {
  return createTransaction(deps, ORG, UID, parseTransactionInput({ type, status: 'actual', accountId, amountMinor, paymentDate }))
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'pln', 'PLN', 100_000)
})

describe('readForecast', () => {
  it('starts from the account balance and finds the first day below the company minimum', async () => {
    await db.doc(`organizations/${ORG}`).update({ cashMinimumMinor: 10_000 })
    await planned('2026-11-05', 'expense', 60_000, 'pln', 'Hosting')
    await planned('2026-11-20', 'expense', 80_000, 'pln', 'VAT')
    const f = await readForecast(deps, ORG)
    expect(f).toMatchObject({ today: '2026-10-27', currency: 'PLN', minimumBase: 10_000, startBase: 100_000, truncated: false, unvalued: 0, approximate: false })
    expect(f.days).toHaveLength(FORECAST_DAYS + 1)
    expect(f.gap).toMatchObject({ date: '2026-11-20', balanceBase: -40_000, shortfallBase: 50_000 })
    expect(f.gap?.causes.map((c) => c.label)).toEqual(['VAT'])
  })

  it('counts an overdue planned payment on today', async () => {
    await planned('2026-10-20', 'expense', 30_000)
    const f = await readForecast(deps, ORG)
    expect(f.days[0].endBalanceBase).toBe(70_000)
  })

  it('has no gap with the default minimum 0 when the balance stays positive, and ignores another company', async () => {
    await planned('2026-11-05', 'expense', 60_000)
    expect((await readForecast(deps, ORG)).gap).toBeNull()
    await seedOrg(db, 'other')
    expect((await readForecast(deps, 'other')).startBase).toBe(0)
  })

  it('converts an EUR account at the latest rate and marks the forecast approximate', async () => {
    await seedAccount(db, ORG, 'eur', 'EUR', 10_000)
    const f = await readForecast(deps, ORG)
    expect(f.approximate).toBe(true)
    expect(f.startBase).toBeGreaterThan(100_000)
  })
})

describe('readCalendarMonth', () => {
  it('shows what happened from the rollups, the planned payments and the balance by day', async () => {
    await actual('2026-10-10', 'income', 50_000)
    await actual('2026-10-12', 'expense', 20_000)
    await planned('2026-10-30', 'expense', 15_000)
    const m = await readCalendarMonth(deps, ORG, 2026, 10)
    expect(m.days).toHaveLength(31)
    expect(m.days[9]).toMatchObject({ date: '2026-10-10', kind: 'past', incomeBase: 50_000 })
    expect(m.days[11]).toMatchObject({ date: '2026-10-12', expenseBase: 20_000 })
    expect(m.days[29]).toMatchObject({ date: '2026-10-30', kind: 'future', plannedExpenseBase: 15_000, endBalanceBase: 100_000 + 50_000 - 20_000 - 15_000 })
    expect(m.days[8].endBalanceBase).toBe(100_000 + 0) // the opening balance seeded before the actual operations
  })

  it('a month beyond the forecast has planned amounts and no balance', async () => {
    await planned('2027-06-10', 'expense', 12_000)
    const m = await readCalendarMonth(deps, ORG, 2027, 6)
    expect(m.days[9]).toMatchObject({ plannedExpenseBase: 12_000, endBalanceBase: null })
  })
})

describe('readCalendarDay', () => {
  it('lists the planned and the actual operations of the day with the series names', async () => {
    await actual('2026-10-20', 'income', 40_000)
    await planned('2026-10-20', 'expense', 9_000, 'pln', 'Rent')
    await planned('2026-10-21', 'expense', 1_000)
    const d = await readCalendarDay(deps, ORG, '2026-10-20')
    expect(d.date).toBe('2026-10-20')
    expect(d.actual.map((a) => a.amountMinor)).toEqual([40_000])
    expect(d.planned.map((p) => p.amountMinor)).toEqual([9_000])
    expect(d.truncated).toBe(false)
  })
})
```

Adjust numbers if the seeding helper differs (read `helpers.ts` and `recurring-read.test.ts` for the exact way an opening balance and an actual operation change `balanceMinor`; the invariant is `balanceMinor = opening + sum of actual operations`). The opening balance seeded by `seedAccount` is `openingMinor`; creating an actual income of 50_000 raises `balanceMinor` to 150_000. Compute the expected values from that invariant before asserting.

- [ ] **Step 2: Run and see it fail**

Run the integration command for `tests/integration/forecast-read.test.ts`.
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/server/forecast/read.ts`**

```ts
import type { Firestore, Query } from 'firebase-admin/firestore'
import { buildCalendarMonth, monthRange } from '@/lib/domain/forecast/calendar'
import { buildForecast, type ForecastInput } from '@/lib/domain/forecast/build'
import { DAY_ROWS, FORECAST_DAYS, type CalendarMonth, type DayActual, type DayPayments, type Forecast } from '@/lib/domain/forecast/types'
import { addDays } from '@/lib/domain/ledger/days'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { MAX_ARRIVAL_DAYS } from '@/lib/domain/ledger/types'
import { balanceRates, balancesReport } from '@/lib/domain/reports/balances'
import { ReportError } from '@/lib/domain/reports/errors'
import { factsFromRollupDocs, selectRollupDocs } from '@/lib/domain/reports/facts'
import { rateKey, valuationDate } from '@/lib/domain/reports/reconcile'
import { REPORT_SCAN_CAP } from '@/lib/domain/reports/types'
import { flatten, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { parsePlannedRow, ROW_FIELDS } from '@/lib/domain/recurring/rows'
import { MAX_SERIES, PLANNED_SCAN, type PlannedRow } from '@/lib/domain/recurring/types'
import { balancesAt, countArrivals, type BalanceReadStats } from '@/lib/server/ledger/balance-at'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { recurringCol, transactionsCol } from '@/lib/server/ledger/paths'
import { readSnapshot, type Reader } from '@/lib/server/ledger/reader'
import { overdueQuery } from '@/lib/server/recurring/read'
import { cellsQuery, readContext, type ReportContext } from '@/lib/server/reports/read'
import { quoteRates } from '@/lib/server/reports/rates'

type ReadDeps = Pick<LedgerDeps, 'db' | 'today' | 'resolveRate'>

/** Planned operations paid from `from` to `to`, by payment day (the index `transactions (status, paymentDate)` of S11). */
function plannedBetween(db: Firestore, orgId: string, from: string, to: string): Query {
  return transactionsCol(db, orgId).where('status', '==', 'planned').where('paymentDate', '>=', from).where('paymentDate', '<=', to).orderBy('paymentDate')
}

const nonNull = <T>(v: T | null): v is T => v !== null

interface Loaded {
  forecast: Forecast
  context: ReportContext
  /** Currency -> the latest rate to the company currency. */
  rates: Map<string, number>
  today: string
}

async function readSeriesNames(r: Reader, db: Firestore, orgId: string): Promise<Record<string, string>> {
  const snap = await r.query(recurringCol(db, orgId).select('name').limit(MAX_SERIES))
  const names: Record<string, string> = {}
  for (const d of snap.docs) {
    const name = d.get('name')
    if (typeof name === 'string') names[d.id] = name
  }
  return names
}

/** The forecast and what it was built from: one read-only snapshot, then the NBP rates (the latest table for each currency). */
async function load(deps: ReadDeps, orgId: string): Promise<Loaded> {
  const { db } = deps
  const today = deps.today()
  const last = addDays(today, FORECAST_DAYS)
  const read = await readSnapshot(db, async (r) => {
    const context = await readContext(r, db, orgId, false)
    const [overdue, upcoming, names] = await Promise.all([
      r.query(overdueQuery(db, orgId, today).orderBy('paymentDate').select(...ROW_FIELDS).limit(PLANNED_SCAN)),
      r.query(plannedBetween(db, orgId, today, last).select(...ROW_FIELDS).limit(PLANNED_SCAN)),
      readSeriesNames(r, db, orgId),
    ])
    const planned = [...overdue.docs, ...upcoming.docs].map((d) => parsePlannedRow(d.id, d.data())).filter(nonNull)
    return { context, planned, names, truncated: overdue.size >= PLANNED_SCAN || upcoming.size >= PLANNED_SCAN }
  })
  const base = read.context.baseCurrency
  const { book } = await quoteRates(deps.resolveRate, base, balanceRates(read.context.accounts, today, base))
  const rates = new Map<string, number>()
  for (const a of read.context.accounts) {
    const quote = book.get(rateKey(a.currency, valuationDate(today)))
    if (a.currency !== base && quote !== undefined) rates.set(a.currency, quote.rate)
  }
  const start = balancesReport({ date: today, baseCurrency: base, accounts: read.context.accounts, balances: new Map(), rates: book })
  const input: ForecastInput = {
    today,
    baseCurrency: base,
    minimumMinor: read.context.cashMinimumMinor,
    startBase: start.totalBase,
    startIncomplete: !start.complete,
    foreignAccounts: read.context.accounts.some((a) => a.currency !== base),
    planned: read.planned,
    rates,
    names: read.names,
    truncated: read.truncated,
  }
  return { forecast: buildForecast(input), context: read.context, rates, today }
}

/** `GET /forecast`: the 90-day balance forecast and the cash gap. */
export async function readForecast(deps: ReadDeps, orgId: string): Promise<Forecast> {
  return (await load(deps, orgId)).forecast
}

/**
 * `GET /calendar?year&month`: a month of the payment calendar. What happened comes from the daily `cash_` rollups of every
 * account (income and expense counted in analytics); what is planned from the planned operations of the month; the balance
 * is the real total for the past days (`balancesAt`, valued at each day's NBP rate) and the forecast from today.
 */
export async function readCalendarMonth(deps: ReadDeps, orgId: string, year: number, month: number): Promise<CalendarMonth> {
  const { db } = deps
  const loaded = await load(deps, orgId)
  const { today, context, forecast } = loaded
  const { first, last } = monthRange(year, month)
  const base = context.baseCurrency
  const pastDays: string[] = []
  for (let d = first; d <= last && d < today; d = addDays(d, 1)) pastDays.push(d)

  const read = await readSnapshot(db, async (r) => {
    const accountIds = new Set(context.accounts.map((a) => a.id))
    const docs: RollupDocs = new Map()
    if (first <= today) {
      for (const snap of await Promise.all([...accountIds].map((id) => r.query(cellsQuery(db, orgId, id, first, last, false))))) {
        for (const d of snap.docs) docs.set(d.id, flatten(d.data()))
      }
    }
    const facts = factsFromRollupDocs(selectRollupDocs(docs, accountIds, { from: first, to: last }, 'cashflow'))
    const movement = new Map<string, { incomeBase: number; expenseBase: number }>()
    for (const days of facts.cash.values()) {
      for (const [day, cell] of days) {
        const m = movement.get(day) ?? { incomeBase: 0, expenseBase: 0 }
        movement.set(day, { incomeBase: m.incomeBase + cell.inBase, expenseBase: m.expenseBase + cell.outBase })
      }
    }
    const planned = (await r.query(plannedBetween(db, orgId, first, last).select(...ROW_FIELDS).limit(PLANNED_SCAN))).docs.map((d) => parsePlannedRow(d.id, d.data())).filter(nonNull)

    let balances = new Map<string, Map<string, number>>()
    if (pastDays.length > 0) {
      const counted = await countArrivals(r, deps, orgId, context.accounts, pastDays, today)
      if ([...counted.values()].reduce((a, b) => a + b, 0) > REPORT_SCAN_CAP) throw new ReportError('too_many_operations', { cap: REPORT_SCAN_CAP })
      const stats: BalanceReadStats = { docsRead: 0, aggregates: 0, ids: new Set(), counted }
      balances = await balancesAt(r, deps, orgId, context.accounts, pastDays, today, stats)
    }
    return { movement, planned, balances, truncated: planned.length >= PLANNED_SCAN }
  })

  // The real total of each past day, valued at that day's NBP rate.
  const needs = pastDays.flatMap((day) => balanceRates(context.accounts, day, base))
  const { book } = await quoteRates(deps.resolveRate, base, needs)
  const pastBalances = new Map<string, number | null>()
  for (const day of pastDays) {
    const atDay = new Map(context.accounts.map((a) => [a.id, read.balances.get(a.id)?.get(day) ?? a.balanceMinor]))
    const report = balancesReport({ date: day, baseCurrency: base, accounts: context.accounts, balances: atDay, rates: book })
    pastBalances.set(day, report.complete ? report.totalBase : null)
  }
  const month_ = buildCalendarMonth({ year, month, today, currency: base, movement: read.movement, planned: read.planned, rates: loaded.rates, pastBalances, forecast })
  return { ...month_, truncated: month_.truncated || read.truncated }
}

/** `GET /calendar/day?date`: the operations paid on a day, planned and actual, at most DAY_ROWS. */
export async function readCalendarDay(deps: ReadDeps, orgId: string, date: string): Promise<DayPayments> {
  const { db } = deps
  return readSnapshot(db, async (r) => {
    const [snap, names] = await Promise.all([
      r.query(transactionsCol(db, orgId).where('paymentDate', '==', date).limit(DAY_ROWS + 1)),
      readSeriesNames(r, db, orgId),
    ])
    const planned: PlannedRow[] = []
    const actual: DayActual[] = []
    for (const d of snap.docs.slice(0, DAY_ROWS)) {
      if (d.get('status') === 'planned') {
        const row = parsePlannedRow(d.id, d.data())
        if (row !== null) planned.push(row)
        continue
      }
      const tx = parseTransaction(d.id, d.data())
      if (tx !== null) actual.push({ id: tx.id, type: tx.type, accountId: tx.accountId, amountMinor: tx.amountMinor, currency: tx.currency, ...(tx.description !== undefined ? { description: tx.description } : {}) })
    }
    return { date, planned, actual, names, truncated: snap.size > DAY_ROWS }
  })
}
```

Export what the file imports from other modules if it is not exported yet (`overdueQuery` is exported in `lib/server/recurring/read.ts`; `cellsQuery`, `readContext`, `ReportContext` are exported from `lib/server/reports/read.ts`; check `flatten`/`RollupDocs` in `lib/domain/ledger/rollups.ts` and `MAX_ARRIVAL_DAYS` — remove the unused import if the compiler says so). Remove any unused import.

Create `lib/server/forecast/index.ts`:

```ts
import 'server-only'
import { ledgerDeps } from '@/lib/server/ledger'
import { readCalendarDay, readCalendarMonth, readForecast } from './read'

/** The forecast and the payment calendar (S13) bound to the production Firestore, NBP rates and the Warsaw clock. Read only. */
export const forecast = {
  get: (orgId: string) => readForecast(ledgerDeps(), orgId),
  month: (orgId: string, year: number, month: number) => readCalendarMonth(ledgerDeps(), orgId, year, month),
  day: (orgId: string, date: string) => readCalendarDay(ledgerDeps(), orgId, date),
}
```

- [ ] **Step 4: Run the integration test and fix**

Run the integration command. Fix wrong expected numbers by working them out from the ledger invariant (not by loosening assertions). The planned-operations cases do not change balances.
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(forecast): server reads of the forecast, the calendar month and the day (S13)"
```

---

### Task 5: Routes, client, hooks

**Files:**
- Create: `app/api/orgs/[orgId]/forecast/route.ts`, `app/api/orgs/[orgId]/calendar/route.ts`, `app/api/orgs/[orgId]/calendar/day/route.ts`, `lib/api/forecast-client.ts`, `lib/hooks/useForecast.ts`, `lib/hooks/useCalendarMonth.ts`, `lib/hooks/useCalendarDay.ts`
- Modify: `tests/e2e/api-guards.spec.ts`

- [ ] **Step 1: Write the three routes**

All three follow `app/api/orgs/[orgId]/reports/balances/route.ts`: `requireUser`, `requireOrgRole(uid, orgId, ['owner','accountant','viewer'])`, `enforceRateLimit(uid, 'reports', REPORT_LIMITS)` (the reads may fetch NBP tables), `toReportHttpError`, `Cache-Control: no-store`, `export const runtime = 'nodejs'`.

`forecast/route.ts`:

```ts
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { forecast } from '@/lib/server/forecast'
import { enforceRateLimit, REPORT_LIMITS } from '@/lib/server/rate-limit-guard'
import { toReportHttpError } from '@/lib/server/reports/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/forecast  (owner, accountant, viewer) -> Forecast (90 days from today, the cash gap)
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    await enforceRateLimit(uid, 'reports', REPORT_LIMITS)
    return Response.json(await forecast.get(orgId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toReportHttpError(e))
  }
}
```

`calendar/route.ts`: same with `const { year, month } = parseCalendarQuery(new URL(req.url).searchParams)` after the role check and `forecast.month(orgId, year, month)`; comment `// GET /api/orgs/{orgId}/calendar?year=2026&month=11 -> CalendarMonth`.

`calendar/day/route.ts`: `parseDayQuery` and `forecast.day(orgId, date)`; comment `// GET /api/orgs/{orgId}/calendar/day?date=YYYY-MM-DD -> DayPayments`.

- [ ] **Step 2: Write the client and hooks**

`lib/api/forecast-client.ts` (same shape as `recurring-client.ts`'s `read`):

```ts
import type { CalendarMonth, DayPayments, Forecast } from '@/lib/domain/forecast/types'
import { readApiError } from './ledger-client'

const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

export const fetchForecast = (orgId: string, signal?: AbortSignal) => read<Forecast>(`${org(orgId)}/forecast`, signal)
export const fetchCalendarMonth = (orgId: string, year: number, month: number, signal?: AbortSignal) =>
  read<CalendarMonth>(`${org(orgId)}/calendar?year=${year}&month=${month}`, signal)
export const fetchCalendarDay = (orgId: string, date: string, signal?: AbortSignal) =>
  read<DayPayments>(`${org(orgId)}/calendar/day?date=${encodeURIComponent(date)}`, signal)
```

The three hooks use `useRecurringRead` (it already refreshes after any ledger or recurring change in this browser):

```ts
// lib/hooks/useForecast.ts
'use client'
import { fetchForecast } from '@/lib/api/forecast-client'
import type { Forecast } from '@/lib/domain/forecast/types'
import { useRecurringRead } from './useRecurringRead'

/** The 90-day forecast and cash gap (S13), read again after any change in this browser. */
export function useForecast(orgId: string): { forecast: Forecast | null; error: boolean } {
  const { data, last, error } = useRecurringRead(orgId, 'forecast', (signal) => fetchForecast(orgId, signal))
  return { forecast: data ?? last, error }
}
```

```ts
// lib/hooks/useCalendarMonth.ts
'use client'
import { fetchCalendarMonth } from '@/lib/api/forecast-client'
import type { CalendarMonth } from '@/lib/domain/forecast/types'
import { useRecurringRead } from './useRecurringRead'

/** One calendar month (S13). While another month is read, `busy` is true and `month` is the previous answer. */
export function useCalendarMonth(orgId: string, year: number, month: number): { data: CalendarMonth | null; busy: boolean; error: boolean } {
  const { data, last, error } = useRecurringRead(orgId, `month:${year}-${month}`, (signal) => fetchCalendarMonth(orgId, year, month, signal))
  return { data: data ?? last, busy: data === null, error }
}
```

```ts
// lib/hooks/useCalendarDay.ts
'use client'
import { fetchCalendarDay } from '@/lib/api/forecast-client'
import type { DayPayments } from '@/lib/domain/forecast/types'
import { useRecurringRead } from './useRecurringRead'

/** The payments of one calendar day (S13), read again after any change (a plan paid or moved). */
export function useCalendarDay(orgId: string, date: string | null): { data: DayPayments | null; error: boolean } {
  const { data, error } = useRecurringRead(orgId, `day:${date ?? ''}`, (signal) => (date === null ? Promise.reject(new Error('no day')) : fetchCalendarDay(orgId, date, signal)))
  return { data: date === null ? null : data, error: date === null ? false : error }
}
```

- [ ] **Step 3: Add the routes to the 401 guard test**

In `tests/e2e/api-guards.spec.ts`, after the recurring entries, add:

```ts
{ method: 'GET', path: '/api/orgs/x/forecast' },
{ method: 'GET', path: '/api/orgs/x/calendar?year=2026&month=11' },
{ method: 'GET', path: '/api/orgs/x/calendar/day?date=2026-11-24' },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx eslint lib app components`
Expected: clean (existing unrelated warnings may remain). Then run the guard spec: e2e command for `tests/e2e/api-guards.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(forecast): routes, client and hooks for the forecast and the calendar (S13)"
```

---

### Task 6: Messages (uk, pl, en)

**Files:** Modify `messages/uk.json`, `messages/pl.json`, `messages/en.json` (targeted text edits; never round-trip the JSON files through `JSON.stringify`).

- [ ] **Step 1: Add a top-level namespace `forecast` and three keys in `settings.company`**

Add to every catalog the same keys. Ukrainian:

```json
"forecast": {
  "gap": {
    "title": "{date}: баланс впаде до {balance} (мінімум {minimum})",
    "titleToday": "Уже зараз баланс нижчий за мінімум: {balance} (мінімум {minimum})",
    "cause": "Найбільший платіж: {label}, {amount}",
    "causeNoLabel": "Найбільший платіж: {amount}",
    "approximate": "Орієнтовно: суми в іншій валюті за останнім курсом НБП",
    "incomplete": "Прогноз може бути неповним",
    "unvalued": "Не враховано сум без курсу: {count}",
    "open": "Показати в календарі"
  },
  "calendar": {
    "title": "Календар платежів",
    "subtitle": "Факт, план і прогноз балансу по днях",
    "view": { "label": "Вигляд", "calendar": "Календар", "chart": "Графік" },
    "prev": "Попередній місяць",
    "next": "Наступний місяць",
    "today": "Сьогодні",
    "income": "Надходження",
    "expense": "Витрати",
    "planned": "План",
    "balance": "Баланс",
    "forecastBalance": "Прогноз",
    "minimum": "Мінімум",
    "gapDay": "Касовий розрив",
    "overdue": "Прострочено: {count}",
    "noForecast": "Далі {days} днів баланс не прогнозується",
    "loading": "Завантаження…",
    "error": "Не вдалося завантажити календар",
    "dayOpen": "Платежі {date}"
  },
  "day": {
    "title": "Платежі {date}",
    "planned": "Заплановані",
    "actual": "Проведені",
    "empty": "У цей день платежів немає",
    "truncated": "Показано перші {count} платежів",
    "close": "Закрити"
  }
}
```

and under `settings.company`: `"minimumLabel": "Мінімальний залишок"`, `"minimumHint": "Попередження про касовий розрив спрацьовує, коли прогноз нижчий за цю суму. 0 означає баланс нижче нуля."`, `"minimumInvalid": "Введіть суму від 0"`.

Polish (`pl.json`): gap.title "{date}: saldo spadnie do {balance} (minimum {minimum})", titleToday "Saldo jest już poniżej minimum: {balance} (minimum {minimum})", cause "Największa płatność: {label}, {amount}", causeNoLabel "Największa płatność: {amount}", approximate "Szacunkowo: kwoty w innej walucie wg ostatniego kursu NBP", incomplete "Prognoza może być niepełna", unvalued "Nie uwzględniono kwot bez kursu: {count}", open "Pokaż w kalendarzu"; calendar.title "Kalendarz płatności", subtitle "Rzeczywistość, plan i prognoza salda dzień po dniu", view.label "Widok", view.calendar "Kalendarz", view.chart "Wykres", prev "Poprzedni miesiąc", next "Następny miesiąc", today "Dzisiaj", income "Wpływy", expense "Wydatki", planned "Plan", balance "Saldo", forecastBalance "Prognoza", minimum "Minimum", gapDay "Luka w gotówce", overdue "Zaległe: {count}", noForecast "Dalej niż {days} dni saldo nie jest prognozowane", loading "Ładowanie…", error "Nie udało się wczytać kalendarza", dayOpen "Płatności {date}"; day.title "Płatności {date}", planned "Zaplanowane", actual "Zaksięgowane", empty "Brak płatności w tym dniu", truncated "Pokazano pierwsze {count} płatności", close "Zamknij"; settings.company minimumLabel "Minimalne saldo", minimumHint "Ostrzeżenie o luce w gotówce działa, gdy prognoza jest niższa niż ta kwota. 0 oznacza saldo poniżej zera.", minimumInvalid "Podaj kwotę od 0".

English (`en.json`): gap.title "{date}: the balance will fall to {balance} (minimum {minimum})", titleToday "The balance is already below the minimum: {balance} (minimum {minimum})", cause "Biggest payment: {label}, {amount}", causeNoLabel "Biggest payment: {amount}", approximate "Approximate: amounts in other currencies use the latest NBP rate", incomplete "The forecast may be incomplete", unvalued "Amounts without a rate are not counted: {count}", open "Show in the calendar"; calendar.title "Payment calendar", subtitle "What happened, what is planned and the forecast balance, day by day", view.label "View", view.calendar "Calendar", view.chart "Chart", prev "Previous month", next "Next month", today "Today", income "Income", expense "Expense", planned "Planned", balance "Balance", forecastBalance "Forecast", minimum "Minimum", gapDay "Cash gap", overdue "Overdue: {count}", noForecast "Beyond {days} days the balance is not forecast", loading "Loading…", error "Could not load the calendar", dayOpen "Payments on {date}"; day.title "Payments on {date}", planned "Planned", actual "Done", empty "No payments on this day", truncated "Showing the first {count} payments", close "Close"; settings.company minimumLabel "Minimum balance", minimumHint "The cash gap warning appears when the forecast is below this amount. 0 means a balance below zero.", minimumInvalid "Enter an amount from 0".

Keep the existing `analytics.calendar.subtitle` and `charts.calendar` keys until Task 10 removes the old calendar (then delete the keys that nothing uses; a unit test or script may check key parity — run `npm run test:local -- tests/unit/i18n` or the repo's message parity test).

- [ ] **Step 2: Verify**

Run the messages parity test (`grep -rln "messages/uk.json" tests/unit` to find it) and `npm run typecheck`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add messages
git commit -m "feat(i18n): messages for the forecast, the calendar and the cash minimum (S13)"
```

---

### Task 7: Settings: the minimum field

**Files:** Modify `app/(app)/[orgSlug]/settings/company/page.tsx`; Test: add to the company settings e2e if one exists (`grep -rln "settings/company" tests/e2e`), else in `tests/e2e/forecast.spec.ts` (Task 11).

- [ ] **Step 1: Add the field**

In the page: new state `minimum` (string), initialised from `org.cashMinimumMinor` with `String(fromMinor(org.cashMinimumMinor)).replace('.', ',')` (use the same display the amount fields use: check `lib/utils/amount-input.ts` for a formatter; if it has none, `fromMinor(x).toFixed(2).replace('.', ',')` is acceptable). Parse with `parseAmountInput(text)` (returns the typed number or null; see `lib/utils/amount-input.ts`), convert with `toMinor`, and treat `null`, negative or non-finite as invalid (`t('minimumInvalid')` below the field, `aria-invalid`, Save disabled). Add a second field after the currency select:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="cashMinimum" className="text-ink">{t('minimumLabel')} ({org?.currency})</Label>
  <Input
    id="cashMinimum"
    data-testid="cash-minimum"
    inputMode="decimal"
    value={minimum}
    onChange={(e) => setMinimum(e.target.value)}
    className="h-9 rounded-control border-line bg-surface"
    aria-invalid={minimumMinor === null}
    disabled={!canEdit}
  />
  <p className="text-xs text-ink-muted">{minimumMinor === null ? t('minimumInvalid') : t('minimumHint')}</p>
</div>
```

`minimumMinor` is `const parsed = parseAmountInput(minimum); const minimumMinor = parsed === null || parsed < 0 ? null : toMinor(parsed)`. `isChanged` also becomes true when `minimumMinor !== null && minimumMinor !== org.cashMinimumMinor`; Save sends `{ name, currency, cashMinimumMinor }` and is blocked while `minimumMinor === null`. Keep the `currency_locked` toast logic.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npx eslint "app/(app)/[orgSlug]/settings/company/page.tsx"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(settings): the cash minimum field in Settings > Company (S13)"
```

---

### Task 8: The cash gap banner and its place in the journal

**Files:**
- Create: `components/forecast/CashGapBanner.tsx`
- Modify: `app/(app)/[orgSlug]/transactions/page.tsx`

- [ ] **Step 1: Write the banner**

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangleIcon } from 'lucide-react'
import type { Forecast } from '@/lib/domain/forecast/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatDayShortUtc } from '@/lib/utils/journal'

interface Props {
  orgId: string
  forecast: Forecast
  /** The calendar page itself shows the banner without the link. */
  link?: boolean
}

/**
 * «24 лис: баланс впаде до −3 200 PLN (мінімум 0)» (S13): shown only when the forecast has a cash gap. Names the largest
 * planned payment of that day, says when the figures are approximate or incomplete, and links to the day in the calendar.
 */
export function CashGapBanner({ orgId, forecast, link = true }: Props) {
  const t = useTranslations('forecast.gap')
  const { locale, money } = useFormatters()
  const gap = forecast.gap
  if (gap === null) return null
  const amount = (minor: number) => money(fromMinor(minor), forecast.currency)
  const day = formatDayShortUtc(new Date(`${gap.date}T00:00:00Z`), locale)
  const title = gap.date === forecast.today ? t('titleToday', { balance: amount(gap.balanceBase), minimum: amount(gap.minimumBase) }) : t('title', { date: day, balance: amount(gap.balanceBase), minimum: amount(gap.minimumBase) })
  const top = gap.causes[0]
  const notes = [forecast.approximate ? t('approximate') : null, forecast.truncated ? t('incomplete') : null, forecast.unvalued > 0 ? t('unvalued', { count: forecast.unvalued }) : null].filter((n): n is string => n !== null)
  return (
    <section data-testid="cash-gap" role="alert" className="flex flex-wrap items-start gap-3 rounded-panel border border-expense/40 bg-expense-soft px-4 py-3 text-sm text-ink">
      <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-expense" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p data-testid="cash-gap-title" className="m-0 font-semibold">{title}</p>
        {top !== undefined && (
          <p data-testid="cash-gap-cause" className="m-0 text-ink-muted">
            {top.label !== null ? t('cause', { label: top.label, amount: money(fromMinor(top.amountMinor), top.currency) }) : t('causeNoLabel', { amount: money(fromMinor(top.amountMinor), top.currency) })}
          </p>
        )}
        {notes.length > 0 && <p data-testid="cash-gap-notes" className="m-0 text-xs text-ink-muted">{notes.join(' · ')}</p>}
      </div>
      {link && (
        <Link data-testid="cash-gap-link" href={`/${orgId}/analytics/calendar?month=${gap.date.slice(0, 7)}&day=${gap.date}`} className="shrink-0 text-brand-soft-foreground underline-offset-4 hover:underline">
          {t('open')}
        </Link>
      )}
    </section>
  )
}
```

(`formatDayShortUtc` is the helper `UpcomingPayments` imports from `@/lib/utils/journal`; if the design tokens `expense-soft` or `border-expense/40` do not exist, use the ones `UpcomingPayments` uses: `bg-expense-soft`, `text-expense`, `border-line`.)

- [ ] **Step 2: Place it in the journal**

In `app/(app)/[orgSlug]/transactions/page.tsx`: import `CashGapBanner` and `useForecast`; call `const { forecast } = useForecast(orgId)` next to the other hooks; render directly above the `PlanMatches` line:

```tsx
{forecast !== null && <CashGapBanner orgId={orgId} forecast={forecast} />}
```

(The banner is for every role: viewers see it too. It does not depend on `canEdit`.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx eslint components/forecast "app/(app)/[orgSlug]/transactions/page.tsx"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(journal): the cash gap banner above the journal (S13)"
```

---

### Task 9: The calendar page: grid, chart, day panel

**Files:**
- Create: `components/forecast/CalendarGrid.tsx`, `components/forecast/CalendarChart.tsx`, `components/forecast/DayPanel.tsx`
- Modify (rewrite): `app/(app)/[orgSlug]/analytics/calendar/page.tsx`

State lives in the address: `?month=YYYY-MM` (default: the Warsaw current month), `?day=YYYY-MM-DD` (opens the day panel), `?view=chart` (default calendar). Use `useSearchParams`, `usePathname`, `useRouter` as the journal does; write with `router.replace`.

- [ ] **Step 1: `CalendarGrid`**

Props: `month: CalendarMonth`, `onOpenDay(date)`, `selectedDay`. Build the weeks with `buildMonthGrid({ year, month: month - 1 })` from `lib/utils/calendar-grid.ts` (check its `YearMonth` type: months there are 0-based as in `shiftMonth`; read the file before using) and `weekdayHeaders(locale)`. A cell is a `<button type="button" data-testid="cal-day" data-date={date}>` for days inside the month (days outside the month are plain greyed `<div>`s). In a cell show: day number; income `+x` (class `text-income`, only when non-zero), expense `−x` (`text-expense`); planned income and planned expense lighter (`opacity-60`, `data-testid="cal-planned"` on the wrapper); `overdueCount > 0` as a small badge `t('overdue', { count })`; the end balance (`data-testid="cal-balance"`, `text-ink-muted`, italic with a dashed top border when `kind !== 'past'` because it is a forecast; nothing when `null`); the gap day gets `data-gap="true"` and a red ring; `belowMinimum` days get `bg-expense-soft`; today gets a brand ring. Amounts use `money(fromMinor(x), month.currency)` with compact display (`formatMoney` already). Cells must stay readable at 390 px: on narrow screens show only the day number, the balance and one dot for planned/overdue; the full figures are in the day panel (use Tailwind `hidden sm:block` for the detail lines).

- [ ] **Step 2: `CalendarChart`**

Use recharts (as `CashFlowChart.tsx` does; copy its `ResponsiveContainer` and axis styling and token colours). Data: one point per day: `{ date, actual: past days only, forecast: today and later }`; make the forecast line start at today's point so the lines join. `LineChart` with two `Line`s (`actual` solid `stroke` brand, `forecast` `strokeDasharray="6 4"`), `ReferenceLine y={month.minimumBase}` labelled with `t('minimum')`, and, when `month.gapDate` is set, `ReferenceLine x={gapDate}` red labelled `t('gapDay')`. Tick values via the formatters. `data-testid="cal-chart"` on the wrapper. `null` balances become gaps (`connectNulls={false}`). Values are in minor units: divide with `fromMinor` before charting.

- [ ] **Step 3: `DayPanel`**

A dialog from `components/ui/dialog.tsx` (look at `components/recurring/MoveDateDialog.tsx` for the exact family, props and focus handling). Props: `orgId`, `date`, `accounts`, `canEdit`, `today`, `onClose`. It calls `useCalendarDay(orgId, date)` and `usePlanActions(orgId, today)`; lists planned rows first (`data-testid="day-planned"`; same row look as `UpcomingPayments`: amount, name (`names[seriesId] ?? description ?? tPlans('unnamed')`), account, overdue and estimated badges, and for `canEdit` the three buttons with `t('planned.markPaid')`, `planned.move`, `planned.skip` from the `recurring` namespace; render `MoveDateDialog` when `plans.moving` is set) and then the actual ones (`data-testid="day-actual"`), `t('day.empty')` when both are empty, `t('day.truncated', { count: 100 })` when `truncated`. Reuse `UpcomingPayments`'s row markup by extracting the planned row into a small shared component `components/recurring/PlannedRowLine.tsx` ONLY IF the duplication is more than ~30 lines; otherwise copy the minimal markup (the plan actions themselves already live in `usePlanActions`).

- [ ] **Step 4: The page**

Rewrite `app/(app)/[orgSlug]/analytics/calendar/page.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
// ... CalendarGrid, CalendarChart, DayPanel, CashGapBanner, Button, useShell, useCalendarMonth, useForecast, formatMonthTitle
```

Behaviour:
- `orgId` from `useShell()`; `today = todayDay()` (the Warsaw day, from `lib/utils/today`).
- Parse `month` with `/^\d{4}-(0[1-9]|1[0-2])$/` else the current month; `day` with `isDay` and only when it lies in the shown month; `view === 'chart' ? 'chart' : 'calendar'`.
- Header: title `t('calendar.title')`, subtitle, previous/next buttons (`aria-label` from `calendar.prev/next`, `data-testid="cal-prev"`/`cal-next`), a "today" button, the month title (`formatMonthTitle`), and a two-button segmented control (`calendar.view.calendar` / `calendar.view.chart`, `data-testid="cal-view-calendar"`/`cal-view-chart`, `aria-pressed`). Changing any of them calls `router.replace` with the updated query string (drop `day` when the month changes).
- `useCalendarMonth(orgId, year, month)` and `useForecast(orgId)`; show `<CashGapBanner link={false} />` when the forecast has a gap; the loading state `t('calendar.loading')` (skeleton like the old page), an error note `t('calendar.error')`, and the notes line (`approximate`, `truncated`, `unvalued`) under the grid; when the month ends after today + 90 days show `t('calendar.noForecast', { days: 90 })`.
- Grid view: `<CalendarGrid onOpenDay=... />` where opening a day sets `day`; chart view: `<CalendarChart />`.
- When `day` is set render `<DayPanel ... onClose={() => remove day} />`.
- The page container comes from `analytics/layout.tsx`; keep `max-w-3xl` off (the grid needs the full width).
- The filters button of the old page is gone (spec: no filters in this version).

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx eslint components/forecast "app/(app)/[orgSlug]/analytics/calendar"` then start the app against the emulators and look at the page (the `run` skill): seed one planned payment and open `/<org>/analytics/calendar`. Confirm the grid, the forecast balance styling, the chart, the day panel and a 390 px width.
Expected: clean lint and types; page renders.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(calendar): the payment calendar page with the month grid, the chart and the day panel (S13)"
```

---

### Task 10: Remove the old calendar

**Files:**
- Delete: `components/charts/CalendarView.tsx`
- Modify: `lib/utils/analytics.ts` (remove `buildCalendar`, `DayData`, `CalendarReport` and helpers only they use), `tests/unit/utils/analytics.test.ts` (remove their tests), `messages/*.json` (remove `charts.calendar` and `analytics.calendar.subtitle` if nothing else uses them: `grep -rn "charts.calendar\|analytics.calendar" app components lib`), `tests/e2e/analytics-filters.spec.ts` line ~174.

- [ ] **Step 1: Remove the code**

Use `grep -rn "buildCalendar\|CalendarView\|CalendarReport\|DayData" lib components app tests` to list every reference, delete the component and the function, and fix the imports. `countsInAnalytics` and other helpers stay if other code uses them.

- [ ] **Step 2: Fix the analytics filters e2e**

In `tests/e2e/analytics-filters.spec.ts` the loop `for (const [name, path] of [['P&L', 'pl'], ['Календар', 'calendar']] as const)` asserts the filter hint on every tab. The calendar no longer has filters: keep the loop for P&L only and add after it:

```ts
await tab(page, 'Календар').click()
await expect(page).toHaveURL(new RegExp(`/analytics/calendar\\?tg=tag-vat$`))
```

(The tag stays in the address; the calendar page ignores it.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run tests/unit` and the e2e command for `tests/e2e/analytics-filters.spec.ts`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(calendar): remove the browser-side calendar the server calendar replaces (S13)"
```

---

### Task 11: e2e and screenshots

**Files:**
- Create: `tests/e2e/forecast.spec.ts`
- Modify: `tests/ui-shots/shots.spec.ts` (the calendar entry still points at the same path and heading `'Календар'`; update the heading to the new page title `'Календар платежів'`) and add a `tests/ui-shots/forecast.spec.ts` with screenshots of the banner, the grid, the chart and the day panel (copy the structure of `tests/ui-shots/recurring.spec.ts`).

- [ ] **Step 1: Write the e2e**

Use the helpers `registerViaUi`, `waitForShell`, `seedLedgerAccount` (see `tests/e2e/recurring.spec.ts` `setup`), and `seedPlanned` and `dayFromToday` from `tests/e2e/helpers/recurring-seed.ts`. Account `acc-a` has 1000 zł. Tests:

1. **banner in the journal and on the calendar**: seed a planned expense of 1500 zł `dayFromToday(5)` with description `VAT-7`. Open `/<org>/transactions`: `cash-gap` is visible, `cash-gap-title` contains the day and `−500` (use a regex for the formatted number, as other specs do with `balanceText`), `cash-gap-cause` contains `VAT-7`. Click `cash-gap-link`: the URL has `/analytics/calendar?month=` and `day=`, the day panel shows `VAT-7` under `day-planned`, the calendar page also shows the banner (without a link).
2. **no gap, no banner**: seed a planned expense of 100 zł: `cash-gap` has count 0 on the journal.
3. **the minimum changes the banner**: seed a planned expense of 600 zł. No banner at minimum 0 (balance 400). Open `/<org>/settings/company`, fill `cash-minimum` with `500`, save, wait for the toast. The journal now shows the banner (balance 400 < 500). Set it back to 0: the banner is gone.
4. **the grid and the chart**: seed a planned 300 zł payment 2 days ahead (use a day that is in the current month; if `today` is within 2 days of the month end, seed it for today instead). On the calendar `cal-day[data-date=…]` shows the planned amount and `cal-balance` shows `700` for that day (1000 − 300); a past day shows `1 000`. Switch to the chart (`cal-view-chart`): `cal-chart` is visible; back to the calendar. Next month (`cal-next`) shows the grid for the next month.
5. **pay from the day panel**: open the day of a planned payment, click `Позначити сплаченою` in the panel, wait for the toast, and assert the account balance fell (`balanceMinor` helper as in `recurring.spec.ts`).
6. **viewer sees the banner**: skip if there is no viewer helper; otherwise note it as not covered.

Expected: all PASS locally. Keep each test independent (its own `registerViaUi`).

- [ ] **Step 2: Screenshots**

Add the ui-shot specs and run them once (`npx playwright test tests/ui-shots/forecast.spec.ts` under the emulators); read the images and compare with the Finmap references in `docs/research/` (the grid with income/expense/balance per day, the chart view). Fix visual problems you can see (cell overflow at 390 px, contrast of the lighter planned amounts, the gap day ring).

- [ ] **Step 3: Verify the whole suite for the touched areas**

Run: `npm run typecheck`, `npm run lint`, `npx vitest run`, the integration files `tests/integration/forecast-read.test.ts` and `recurring-read.test.ts`, and the e2e files `forecast.spec.ts recurring.spec.ts app-shell.spec.ts analytics-filters.spec.ts api-guards.spec.ts`.
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(forecast): e2e and screenshots for the banner, the calendar and the minimum (S13)"
```

---

### Task 12: Documentation and the final check

**Files:** Modify `CLAUDE.md`, `PROGRESS.md`; update the spec status line.

- [ ] **Step 1: CLAUDE.md**

Add a section "Payment calendar, forecast and cash gap (S13)" with: the pure functions (`lib/domain/forecast`), the three routes and their shapes, `FORECAST_DAYS` = 90, overdue counted on today, transfers excluded, the latest NBP rate and the `approximate` flag, `cashMinimumMinor` on the company document (default 0, saved by `PATCH /orgs/{org}`, no rules change), the banner (`CashGapBanner`, in the journal and on the calendar), the calendar page state in the address (`month`, `day`, `view`), the removed browser-side calendar, the gotchas found during the work. Update the sentence in "Working today" if it mentions the old calendar.

- [ ] **Step 2: PROGRESS.md**

Add "### S13: платіжний календар, прогноз і касовий розрив (2026-11-…)" in the style of the S12d section: what was built, the evidence that actually ran (unit, integration, e2e counts), what was not checked (pl/en visual check, a 390 px phone on real data, production data), and the known limits from the spec.

- [ ] **Step 3: Spec status**

Change the status line of the spec to "реалізовано (PR #…)" after the PR exists (leave the number to the PR step).

- [ ] **Step 4: Final verification**

Run the full local gate that the repo documents for PRs: `npm run typecheck`, `npm run lint`, `npx vitest run`, the full integration run (`vitest.integration.config.ts` under the Firestore emulator) and the full e2e run. Report the real numbers.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(s13): payment calendar, forecast and cash gap in CLAUDE.md and PROGRESS.md"
```

Then push the branch and open a **draft** PR titled `feat(forecast): payment calendar, balance forecast and cash gap signal (S13)`; do not merge without the owner's explicit OK.
