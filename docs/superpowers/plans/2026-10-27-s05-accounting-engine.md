# S05 Accounting Engine v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make money in FinFlow correct by construction: the server is the only writer of accounts, transactions, rollups and audit; every operation has two dates; the account balance always equals the opening balance plus the sum of actual operations.

**Architecture:** A pure domain layer `lib/domain/ledger/` (money in integer minor units, input parsing, validation, balance effects, rollup contributions, period allocation, expected-ledger oracle) is shared by the server and the client. `lib/server/ledger/` runs every change as one Firestore Admin transaction (operation + account balances + rollup increments + audit) and offers `verifyLedger` / `rebuildLedger`. API routes under `app/api/orgs/[orgId]/` are the only write path; Firestore rules close client writes. A tsx migration script moves existing data to schema v2. Spec: `docs/superpowers/specs/2026-10-27-s05-accounting-engine-design.md`.

**Tech Stack:** TypeScript, Next.js 16 route handlers, firebase-admin 14 (server) / firebase 12 (client reads), Vitest (unit, Firestore-emulator integration, rules), Playwright, tsx (new devDependency, migration only).

**Conventions for every task**
- Work on branch `s05-accounting-engine` in `F:\AI\finflow`. Commit at the end of each task (message given in the task). Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Use Edit/Write for files, not shell heredocs or `sed`, except where the task explicitly says to run a command.
- Comments and identifiers in English. User-visible text only via the message catalogs (`messages/{uk,pl,en}.json`); `tests/unit/i18n/no-hardcoded-text.test.ts` forbids Cyrillic in app code.
- Domain code (`lib/domain/ledger/**`) imports no Firebase, no `server-only`, no `next`.
- All dates are `YYYY-MM-DD` strings (UTC day, "Warsaw today" supplied by the caller). All money is an integer in minor units (`...Minor`), 1/100 of the currency.
- Verification commands: unit `npm run test:local`-style is not available here; use `npx vitest run --config vitest.config.ts <paths>`; typecheck `npm run typecheck`; lint `npm run lint`. Emulator suites: `npm run test:rules`, `npm run test:integration` (Task 1 adds it). Java for emulators: prefix `PATH="$HOME/.jre/temurin-21/bin:$PATH"`.

---

### Task 1: Tooling and day helpers

**Model:** haiku

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm i -D tsx`), `.github/workflows/ci.yml`
- Create: `vitest.integration.config.ts`
- Move: `lib/server/fx/days.ts` -> `lib/domain/ledger/days.ts`; `tests/unit/server/fx/days.test.ts` -> `tests/unit/domain/ledger/days.test.ts`
- Modify (imports only): `lib/server/fx/nbp.ts`, `lib/server/fx/resolver.ts`, `lib/server/fx/store.ts`, `app/api/rates/route.ts`, `tests/unit/server/fx/helpers.ts`

- [ ] **Step 1: Install tsx**

Run: `cd /f/AI/finflow && npm i -D tsx`
Expected: `package.json` gets `"tsx"` in devDependencies and `package-lock.json` changes.

- [ ] **Step 2: Add npm scripts**

In `package.json` `scripts`, add after `"test:rules"`:

```json
"test:integration": "firebase emulators:exec --only firestore --project demo-finflow \"vitest run --config vitest.integration.config.ts\"",
"migrate:ledger": "node --conditions=react-server --import tsx scripts/migrate-ledger-v2.ts",
```

- [ ] **Step 3: Create the integration Vitest config**

`vitest.integration.config.ts`:

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = import.meta.dirname

// Server-side ledger tests against the Firestore emulator (Admin SDK). Run through
// `npm run test:integration`, which starts the emulator and sets FIRESTORE_EMULATOR_HOST.
export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      'server-only': resolve(root, 'tests/unit/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // All files share one emulator database.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
```

- [ ] **Step 4: Add the CI step**

In `.github/workflows/ci.yml`, directly after the step named `Firestore rules tests (emulator)` add:

```yaml
      - name: Ledger integration tests (emulator)
        run: npm run test:integration
```

- [ ] **Step 5: Move the day helpers**

Run:

```bash
cd /f/AI/finflow
mkdir -p lib/domain/ledger tests/unit/domain/ledger
git mv lib/server/fx/days.ts lib/domain/ledger/days.ts
git mv tests/unit/server/fx/days.test.ts tests/unit/domain/ledger/days.test.ts
```

Then in each of the files `lib/server/fx/nbp.ts`, `lib/server/fx/resolver.ts`, `lib/server/fx/store.ts`, `app/api/rates/route.ts`, `tests/unit/server/fx/helpers.ts`, `tests/unit/domain/ledger/days.test.ts` replace the import path `'@/lib/server/fx/days'` with `'@/lib/domain/ledger/days'` (Edit tool, one file at a time).

- [ ] **Step 6: Write the failing tests for the new helpers**

Append to `tests/unit/domain/ledger/days.test.ts` (extend the existing import line to also import `compareDays, daysInRange, isMonth, monthsBetween, nextMonth, overlapDays, toDay, fromDay`):

```ts
describe('ledger day helpers', () => {
  it('isMonth accepts only YYYY-MM with a real month', () => {
    expect(isMonth('2026-10')).toBe(true)
    expect(isMonth('2026-13')).toBe(false)
    expect(isMonth('2026-1')).toBe(false)
    expect(isMonth(5)).toBe(false)
  })

  it('nextMonth rolls the year', () => {
    expect(nextMonth('2026-10')).toBe('2026-11')
    expect(nextMonth('2026-12')).toBe('2027-01')
  })

  it('monthsBetween is inclusive of both end months', () => {
    expect(monthsBetween('2026-01-15', '2026-03-02')).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(monthsBetween('2026-12-31', '2027-01-01')).toEqual(['2026-12', '2027-01'])
    expect(monthsBetween('2026-05-10', '2026-05-10')).toEqual(['2026-05'])
  })

  it('daysInRange counts both ends', () => {
    expect(daysInRange('2026-02-27', '2026-03-02')).toBe(4)
    expect(daysInRange('2026-05-10', '2026-05-10')).toBe(1)
  })

  it('overlapDays counts the days of a month inside a range', () => {
    expect(overlapDays('2026-01', '2026-01-15', '2026-03-02')).toBe(17)
    expect(overlapDays('2026-02', '2026-01-15', '2026-03-02')).toBe(28)
    expect(overlapDays('2026-03', '2026-01-15', '2026-03-02')).toBe(2)
    expect(overlapDays('2026-04', '2026-01-15', '2026-03-02')).toBe(0)
  })

  it('compareDays orders day strings', () => {
    expect(compareDays('2026-01-02', '2026-01-10')).toBeLessThan(0)
    expect(compareDays('2026-01-10', '2026-01-10')).toBe(0)
  })

  it('toDay / fromDay convert between a UTC-midnight Date and a day string', () => {
    const d = fromDay('2026-10-27')
    expect(d.toISOString()).toBe('2026-10-27T00:00:00.000Z')
    expect(toDay(d)).toBe('2026-10-27')
  })
})
```

- [ ] **Step 7: Run to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger/days.test.ts`
Expected: FAIL (the new helpers are not exported).

- [ ] **Step 8: Add the helpers**

Append to `lib/domain/ledger/days.ts`:

```ts
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY_MS = 24 * 60 * 60 * 1000

/** True for YYYY-MM with a real month. */
export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && MONTH.test(s)
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}

/** Negative, zero or positive like a comparator; day strings sort lexicographically. */
export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Months from the month of `from` to the month of `to`, both included, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  const last = monthOf(to)
  for (let m = monthOf(from); m <= last; m = nextMonth(m)) months.push(m)
  return months
}

/** Days from `from` to `to`, both included. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

/** How many days of `month` fall inside [from, to]. */
export function overlapDays(month: string, from: string, to: string): number {
  const { first, last } = monthBounds(month)
  const lo = from > first ? from : first
  const hi = to < last ? to : last
  return lo > hi ? 0 : daysInRange(lo, hi)
}

/** A Date at 00:00 UTC as a day string (the app's calendar-day convention). */
export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** A day string as a Date at 00:00 UTC. */
export function fromDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}
```

- [ ] **Step 9: Verify**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger/days.test.ts tests/unit/server/fx` and `npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: ledger tooling (tsx, integration config, CI step) and shared day helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain types, errors, money, period allocation

**Model:** sonnet

**Files:**
- Create: `lib/domain/ledger/types.ts`, `errors.ts`, `money.ts`, `period.ts`
- Create: `tests/unit/domain/ledger/money.test.ts`, `period.test.ts`

- [ ] **Step 1: Write `lib/domain/ledger/types.ts`**

```ts
export const TX_TYPES = ['income', 'expense', 'transfer'] as const
export type TxType = (typeof TX_TYPES)[number]

export const TX_STATUSES = ['actual', 'planned'] as const
export type TxStatus = (typeof TX_STATUSES)[number]

export const ACCOUNT_TYPES = ['bank', 'cash', 'card', 'crypto'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const LEDGER_CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH'] as const

/** When an operation counts for the P&L: on one day, or spread over a period. */
export type Accrual = { mode: 'date'; date: string } | { mode: 'period'; from: string; to: string }

/** The evidence stored next to a converted amount (a final NBP snapshot, S04). */
export interface RateEvidence {
  rate: number
  from: string
  to: string
  requestedDate: string
  rateDate: string
  tableNo: string | null
  source: 'NBP_A' | 'identity'
}

export interface Fx {
  payment?: RateEvidence
  accrual?: RateEvidence
}

/** The amount in the company currency (minor units), per date. */
export interface Base {
  payment: number
  accrual: number
}

export interface LedgerTransaction {
  id: string
  type: TxType
  status: TxStatus
  accountId: string
  /** Positive, in the minor units of `currency`. */
  amountMinor: number
  /** Always the currency of `accountId`. */
  currency: string
  toAccountId?: string
  toAmountMinor?: number
  toCurrency?: string
  paymentDate: string
  accrual: Accrual
  categoryId?: string
  counterpartyId?: string
  description?: string
  isRecurring: boolean
  projectId?: string
  tags: string[]
  fileUrls: string[]
  /** Only actual income/expense in a currency other than the company's. */
  fx?: Fx
  base?: Base
}

export interface LedgerAccount {
  id: string
  name: string
  type: AccountType
  currency: string
  color: string
  openingMinor: number
  balanceMinor: number
}
```

- [ ] **Step 2: Write `errors.ts`**

```ts
export type LedgerErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'account_not_found'
  | 'category_not_found'
  | 'currency_mismatch'
  | 'future_actual'
  | 'account_has_operations'
  | 'currency_locked'
  | 'ledger_busy'
  | 'conflict'

/** An expected failure of a ledger operation. `field` names the offending input field, if any. */
export class LedgerError extends Error {
  public readonly code: LedgerErrorCode
  public readonly field?: string

  constructor(code: LedgerErrorCode, field?: string) {
    super(field === undefined ? code : `${code}:${field}`)
    this.name = 'LedgerError'
    this.code = code
    this.field = field
  }
}
```

- [ ] **Step 3: Write the failing money tests**

`tests/unit/domain/ledger/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_MINOR, fromMinor, isMinor, mulRate, toMinor } from '@/lib/domain/ledger/money'

describe('toMinor / fromMinor', () => {
  it.each([
    [12.34, 1234],
    [1234.6, 123460],
    [0.1 + 0.2, 30],
    [0.29, 29],
    [10.5, 1050],
    [-0.1, -10],
    [0, 0],
  ])('toMinor(%s) = %s', (major, minor) => {
    expect(toMinor(major)).toBe(minor)
  })

  it('never returns -0', () => {
    expect(Object.is(toMinor(-0.001), 0)).toBe(true)
  })

  it('rejects a non-finite amount', () => {
    expect(() => toMinor(Number.NaN)).toThrow(RangeError)
    expect(() => toMinor(Infinity)).toThrow(RangeError)
  })

  it('fromMinor is the inverse for 2-decimal amounts', () => {
    expect(fromMinor(123460)).toBe(1234.6)
    expect(fromMinor(-10)).toBe(-0.1)
  })
})

describe('mulRate', () => {
  it('rounds half away from zero', () => {
    expect(mulRate(1000, 4.4026)).toBe(4403)
    expect(mulRate(-1000, 4.4026)).toBe(-4403)
    expect(mulRate(5, 0.5)).toBe(3)
    expect(mulRate(-5, 0.5)).toBe(-3)
    expect(mulRate(1, 0.0001)).toBe(0)
  })
})

describe('isMinor', () => {
  it('accepts safe integers only', () => {
    expect(isMinor(5)).toBe(true)
    expect(isMinor(-5)).toBe(true)
    expect(isMinor(0.5)).toBe(false)
    expect(isMinor('5')).toBe(false)
    expect(isMinor(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
  })
  it('MAX_MINOR is a safe integer', () => {
    expect(Number.isSafeInteger(MAX_MINOR)).toBe(true)
  })
})
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger/money.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Write `money.ts`**

```ts
import { roundAmount } from '@/lib/utils/amount-input'

/** Largest operation amount: 10^13 minor units (10^11 of the currency). */
export const MAX_MINOR = 10 ** 13

export function isMinor(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n)
}

/** An amount in the currency as the integer of its minor units (2 decimals, half away from zero). */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) throw new RangeError('amount is not finite')
  // roundAmount makes the value an exact 2-decimal number; the multiplication can still land a hair
  // off an integer, which Math.round absorbs.
  return Math.round(roundAmount(major) * 100) || 0
}

export function fromMinor(minor: number): number {
  return minor / 100
}

/** `minor * rate` as an integer, half away from zero. */
export function mulRate(minor: number, rate: number): number {
  const scaled = Number((Math.abs(minor) * rate).toPrecision(15))
  const rounded = Math.round(scaled)
  return rounded === 0 ? 0 : minor < 0 ? -rounded : rounded
}
```

- [ ] **Step 6: Write the failing period tests**

`tests/unit/domain/ledger/period.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { allocatePeriod } from '@/lib/domain/ledger/period'

const sum = (parts: Array<[string, number]>) => parts.reduce((a, [, v]) => a + v, 0)

describe('allocatePeriod', () => {
  it('splits by days and puts the remainder in the last month', () => {
    const parts = allocatePeriod(1000, '2026-01-15', '2026-03-02')
    expect(parts).toEqual([
      ['2026-01', 361],
      ['2026-02', 595],
      ['2026-03', 44],
    ])
    expect(sum(parts)).toBe(1000)
  })

  it('keeps the sign for a negative total', () => {
    const parts = allocatePeriod(-1000, '2026-01-15', '2026-03-02')
    expect(parts).toEqual([
      ['2026-01', -361],
      ['2026-02', -595],
      ['2026-03', -44],
    ])
  })

  it('one month gets everything', () => {
    expect(allocatePeriod(777, '2026-05-01', '2026-05-31')).toEqual([['2026-05', 777]])
  })

  it('crosses a year end and a leap February', () => {
    const parts = allocatePeriod(10_000, '2027-12-20', '2028-03-10')
    expect(parts.map(([m]) => m)).toEqual(['2027-12', '2028-01', '2028-02', '2028-03'])
    expect(sum(parts)).toBe(10_000)
  })

  it('never produces -0', () => {
    for (const [, v] of allocatePeriod(-1, '2026-01-01', '2026-03-31')) {
      expect(Object.is(v, -0)).toBe(false)
    }
  })

  it('is exact for the largest amounts (no float overflow in the multiplication)', () => {
    const parts = allocatePeriod(50_000_000_000_000, '2026-01-01', '2028-12-31')
    expect(sum(parts)).toBe(50_000_000_000_000)
  })
})
```

- [ ] **Step 7: Write `period.ts`**

```ts
import { monthsBetween, overlapDays } from './days'

/**
 * Splits `total` over the calendar months of [from, to] in proportion to the days of each month
 * inside the range. Every month but the last gets floor(|total| * days / allDays); the last gets
 * the rest, so the parts always add up to `total` exactly. BigInt keeps the product exact.
 */
export function allocatePeriod(total: number, from: string, to: string): Array<[string, number]> {
  const months = monthsBetween(from, to)
  const days = months.map((m) => overlapDays(m, from, to))
  const allDays = days.reduce((a, b) => a + b, 0)
  const abs = Math.abs(total)
  const sign = total < 0 ? -1 : 1
  let used = 0
  return months.map((month, i): [string, number] => {
    const part =
      i === months.length - 1 ? abs - used : Number((BigInt(abs) * BigInt(days[i])) / BigInt(allDays))
    used += part
    return [month, part === 0 ? 0 : sign * part]
  })
}
```

- [ ] **Step 8: Verify and commit**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger` and `npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(ledger): domain types, errors, money and period allocation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Domain input parsing, validation and fx planning

**Model:** sonnet

**Files:**
- Create: `lib/domain/ledger/guards.ts`, `input.ts`, `build.ts`, `entity-input.ts`
- Create: `tests/unit/domain/ledger/input.test.ts`, `build.test.ts`, `entity-input.test.ts`

- [ ] **Step 1: Write `guards.ts`**

```ts
import { LedgerError } from './errors'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const RESERVED = /^__.*__$/

export function bad(field: string): never {
  throw new LedgerError('invalid_input', field)
}

/** A Firestore-safe document id from a request. Dots are excluded, `__x__` is reserved. */
export function isId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v) && !RESERVED.test(v)
}

export function asRecord(v: unknown, field = 'body'): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field)
  return v as Record<string, unknown>
}

export function onlyKeys(r: Record<string, unknown>, allowed: readonly string[], prefix = ''): void {
  for (const k of Object.keys(r)) if (!allowed.includes(k)) bad(`${prefix}${k}`)
}
```

- [ ] **Step 2: Write the failing input tests**

`tests/unit/domain/ledger/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { applyPatch, parseTransactionInput, parseTransactionPatch, toRawInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const BASE = { type: 'expense', accountId: 'acc1', amountMinor: 1234, paymentDate: '2026-10-20' }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'none'
}

describe('parseTransactionInput', () => {
  it('fills the defaults', () => {
    expect(parseTransactionInput(BASE)).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'acc1',
      amountMinor: 1234,
      paymentDate: '2026-10-20',
      accrual: { mode: 'date', date: '2026-10-20' },
      isRecurring: false,
      tags: [],
      fileUrls: [],
    })
  })

  it('keeps optional fields and trims the description', () => {
    const out = parseTransactionInput({
      ...BASE,
      categoryId: 'cat1',
      counterpartyId: 'cp1',
      description: '  rent  ',
      projectId: 'p1',
      tags: ['a'],
      isRecurring: true,
      clientId: 'client-12345678',
    })
    expect(out).toMatchObject({
      categoryId: 'cat1',
      counterpartyId: 'cp1',
      description: 'rent',
      projectId: 'p1',
      tags: ['a'],
      isRecurring: true,
      clientId: 'client-12345678',
    })
  })

  it('parses a period accrual', () => {
    const out = parseTransactionInput({ ...BASE, accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' } })
    expect(out.accrual).toEqual({ mode: 'period', from: '2026-10-01', to: '2026-12-31' })
  })

  it('parses a transfer', () => {
    const out = parseTransactionInput({ type: 'transfer', accountId: 'a', toAccountId: 'b', amountMinor: 5, toAmountMinor: 7, paymentDate: '2026-10-20' })
    expect(out).toMatchObject({ type: 'transfer', toAccountId: 'b', toAmountMinor: 7, accrual: { mode: 'date', date: '2026-10-20' } })
  })

  it.each([
    ['a non-object body', 'x', 'invalid_input:body'],
    ['an unknown key', { ...BASE, nope: 1 }, 'invalid_input:nope'],
    ['a bad type', { ...BASE, type: 'refund' }, 'invalid_input:type'],
    ['a bad status', { ...BASE, status: 'done' }, 'invalid_input:status'],
    ['a zero amount', { ...BASE, amountMinor: 0 }, 'invalid_input:amountMinor'],
    ['a fractional amount', { ...BASE, amountMinor: 1.5 }, 'invalid_input:amountMinor'],
    ['a string amount', { ...BASE, amountMinor: '5' }, 'invalid_input:amountMinor'],
    ['an amount over the cap', { ...BASE, amountMinor: 10 ** 13 + 1 }, 'invalid_input:amountMinor'],
    ['a bad account id', { ...BASE, accountId: 'a/b' }, 'invalid_input:accountId'],
    ['a reserved id', { ...BASE, accountId: '__x__' }, 'invalid_input:accountId'],
    ['an impossible date', { ...BASE, paymentDate: '2026-02-30' }, 'invalid_input:paymentDate'],
    ['a date before 2000', { ...BASE, paymentDate: '1999-12-31' }, 'invalid_input:paymentDate'],
    ['an unknown accrual mode', { ...BASE, accrual: { mode: 'x' } }, 'invalid_input:accrual.mode'],
    ['a reversed period', { ...BASE, accrual: { mode: 'period', from: '2026-10-05', to: '2026-10-01' } }, 'invalid_input:accrual.to'],
    ['a period over 36 months', { ...BASE, accrual: { mode: 'period', from: '2026-01-01', to: '2029-02-01' } }, 'invalid_input:accrual.to'],
    ['an extra accrual key', { ...BASE, accrual: { mode: 'date', date: '2026-10-20', x: 1 } }, 'invalid_input:accrual.x'],
    ['a long description', { ...BASE, description: 'x'.repeat(501) }, 'invalid_input:description'],
    ['too many tags', { ...BASE, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, 'invalid_input:tags'],
    ['a short clientId', { ...BASE, clientId: 'abc' }, 'invalid_input:clientId'],
    ['a transfer without a target', { type: 'transfer', accountId: 'a', amountMinor: 5, paymentDate: '2026-10-20' }, 'invalid_input:toAccountId'],
    ['a transfer with a category', { type: 'transfer', accountId: 'a', toAccountId: 'b', amountMinor: 5, paymentDate: '2026-10-20', categoryId: 'c' }, 'invalid_input:categoryId'],
    ['a transfer with an accrual', { type: 'transfer', accountId: 'a', toAccountId: 'b', amountMinor: 5, paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' } }, 'invalid_input:accrual'],
    ['an expense with a target account', { ...BASE, toAccountId: 'b' }, 'invalid_input:toAccountId'],
  ])('rejects %s', (_label, body, expected) => {
    expect(code(() => parseTransactionInput(body))).toBe(expected)
  })
})

describe('patches', () => {
  const existing: LedgerTransaction = {
    id: 't1',
    type: 'expense',
    status: 'actual',
    accountId: 'acc1',
    amountMinor: 1234,
    currency: 'PLN',
    paymentDate: '2026-10-20',
    accrual: { mode: 'date', date: '2026-10-20' },
    categoryId: 'cat1',
    description: 'old',
    isRecurring: false,
    tags: [],
    fileUrls: [],
  }

  it('toRawInput omits an accrual that just follows the payment date', () => {
    expect(toRawInput(existing)).not.toHaveProperty('accrual')
    const spread = { ...existing, accrual: { mode: 'date' as const, date: '2026-09-01' } }
    expect(toRawInput(spread)).toHaveProperty('accrual', { mode: 'date', date: '2026-09-01' })
  })

  it('toRawInput leaves out the target amount of a same-currency transfer but keeps a cross-currency one', () => {
    const transfer: LedgerTransaction = { ...existing, type: 'transfer', categoryId: undefined, toAccountId: 'b', toAmountMinor: 1234, toCurrency: 'PLN' }
    expect(toRawInput(transfer)).not.toHaveProperty('toAmountMinor')
    expect(toRawInput({ ...transfer, toAmountMinor: 300, toCurrency: 'EUR' })).toHaveProperty('toAmountMinor', 300)
  })

  it('parseTransactionPatch needs at least one key and allows null only where optional', () => {
    expect(code(() => parseTransactionPatch({}))).toBe('invalid_input:body')
    expect(code(() => parseTransactionPatch({ amountMinor: null }))).toBe('invalid_input:amountMinor')
    expect(code(() => parseTransactionPatch({ clientId: 'abcdefgh' }))).toBe('invalid_input:clientId')
    expect(parseTransactionPatch({ categoryId: null })).toEqual({ categoryId: null })
  })

  it('applyPatch merges, clears with null, and follows the payment date', () => {
    const next = applyPatch(toRawInput(existing), { amountMinor: 1235, description: null, paymentDate: '2026-10-21' })
    expect(next.amountMinor).toBe(1235)
    expect(next).not.toHaveProperty('description')
    expect(next.paymentDate).toBe('2026-10-21')
    expect(next.accrual).toEqual({ mode: 'date', date: '2026-10-21' })
    expect(next.categoryId).toBe('cat1')
  })

  it('applyPatch revalidates the merged result', () => {
    expect(code(() => applyPatch(toRawInput(existing), { type: 'transfer' }))).toBe('invalid_input:toAccountId')
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger/input.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Write `input.ts`**

```ts
import { asRecord, bad, isId, onlyKeys } from './guards'
import { isDay, monthsBetween } from './days'
import { MAX_MINOR, isMinor } from './money'
import { TX_STATUSES, TX_TYPES, type Accrual, type LedgerTransaction, type TxStatus, type TxType } from './types'

export const MAX_PERIOD_MONTHS = 36
export const MIN_DAY = '2000-01-01'

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/
const RESERVED = /^__.*__$/

const CREATE_KEYS = [
  'clientId', 'type', 'status', 'accountId', 'amountMinor', 'toAccountId', 'toAmountMinor', 'paymentDate',
  'accrual', 'categoryId', 'counterpartyId', 'description', 'isRecurring', 'projectId', 'tags', 'fileUrls',
] as const
const PATCH_KEYS = CREATE_KEYS.filter((k) => k !== 'clientId')
const NULLABLE = new Set(['toAccountId', 'toAmountMinor', 'accrual', 'categoryId', 'counterpartyId', 'description', 'projectId'])

/** A validated create request (defaults filled). Amounts are minor units. */
export interface TransactionInput {
  clientId?: string
  type: TxType
  status: TxStatus
  accountId: string
  amountMinor: number
  toAccountId?: string
  toAmountMinor?: number
  paymentDate: string
  accrual: Accrual
  categoryId?: string
  counterpartyId?: string
  description?: string
  isRecurring: boolean
  projectId?: string
  tags: string[]
  fileUrls: string[]
}

/** The editable fields of an existing operation, before defaults (input of `applyPatch`). */
export type RawInput = Record<string, unknown>

/** A partial update: a key set to null clears an optional field. */
export type TransactionPatch = Record<string, unknown>

function day(v: unknown, field: string): string {
  if (!isDay(v) || v < MIN_DAY) bad(field)
  return v
}

function amount(v: unknown, field: string): number {
  if (!isMinor(v) || v <= 0 || v > MAX_MINOR) bad(field)
  return v
}

function parseAccrual(v: unknown): Accrual {
  const r = asRecord(v, 'accrual')
  if (r.mode === 'date') {
    onlyKeys(r, ['mode', 'date'], 'accrual.')
    return { mode: 'date', date: day(r.date, 'accrual.date') }
  }
  if (r.mode === 'period') {
    onlyKeys(r, ['mode', 'from', 'to'], 'accrual.')
    const from = day(r.from, 'accrual.from')
    const to = day(r.to, 'accrual.to')
    if (from > to || monthsBetween(from, to).length > MAX_PERIOD_MONTHS) bad('accrual.to')
    return { mode: 'period', from, to }
  }
  return bad('accrual.mode')
}

function stringList(v: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > maxItems) bad(field)
  return v.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLength) bad(field)
    return item
  })
}

export function parseTransactionInput(body: unknown): TransactionInput {
  const r = asRecord(body)
  onlyKeys(r, CREATE_KEYS)

  if (!(TX_TYPES as readonly unknown[]).includes(r.type)) bad('type')
  const type = r.type as TxType
  const status = r.status === undefined ? 'actual' : r.status
  if (!(TX_STATUSES as readonly unknown[]).includes(status)) bad('status')

  if (r.clientId !== undefined && !(typeof r.clientId === 'string' && CLIENT_ID.test(r.clientId) && !RESERVED.test(r.clientId))) {
    bad('clientId')
  }
  if (!isId(r.accountId)) bad('accountId')
  const paymentDate = day(r.paymentDate, 'paymentDate')

  const out: TransactionInput = {
    type,
    status: status as TxStatus,
    accountId: r.accountId,
    amountMinor: amount(r.amountMinor, 'amountMinor'),
    paymentDate,
    accrual: { mode: 'date', date: paymentDate },
    isRecurring: false,
    tags: stringList(r.tags, 'tags', 20, 50),
    fileUrls: stringList(r.fileUrls, 'fileUrls', 10, 2048),
  }
  if (r.clientId !== undefined) out.clientId = r.clientId as string

  if (type === 'transfer') {
    if (!isId(r.toAccountId)) bad('toAccountId')
    out.toAccountId = r.toAccountId
    if (r.toAmountMinor !== undefined) out.toAmountMinor = amount(r.toAmountMinor, 'toAmountMinor')
    if (r.categoryId !== undefined) bad('categoryId')
    if (r.accrual !== undefined) bad('accrual')
    if (r.counterpartyId !== undefined) bad('counterpartyId')
  } else {
    if (r.toAccountId !== undefined) bad('toAccountId')
    if (r.toAmountMinor !== undefined) bad('toAmountMinor')
    if (r.accrual !== undefined) out.accrual = parseAccrual(r.accrual)
    if (r.categoryId !== undefined) {
      if (!isId(r.categoryId)) bad('categoryId')
      out.categoryId = r.categoryId
    }
    if (r.counterpartyId !== undefined) {
      if (!isId(r.counterpartyId)) bad('counterpartyId')
      out.counterpartyId = r.counterpartyId
    }
  }

  if (r.projectId !== undefined) {
    if (!isId(r.projectId)) bad('projectId')
    out.projectId = r.projectId
  }
  if (r.description !== undefined) {
    if (typeof r.description !== 'string') bad('description')
    const text = r.description.trim()
    if (text.length > 500) bad('description')
    if (text.length > 0) out.description = text
  }
  if (r.isRecurring !== undefined) {
    if (typeof r.isRecurring !== 'boolean') bad('isRecurring')
    out.isRecurring = r.isRecurring
  }
  return out
}

/** Validates the shape of a PATCH body: known keys, null only for optional fields, at least one key. */
export function parseTransactionPatch(body: unknown): TransactionPatch {
  const r = asRecord(body)
  onlyKeys(r, PATCH_KEYS)
  if (Object.keys(r).length === 0) bad('body')
  for (const [key, value] of Object.entries(r)) {
    if (value === null && !NULLABLE.has(key)) bad(key)
  }
  return r
}

/** The editable fields of an existing operation. An accrual that just follows the payment date is left out. */
export function toRawInput(tx: LedgerTransaction): RawInput {
  const raw: RawInput = {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    amountMinor: tx.amountMinor,
    paymentDate: tx.paymentDate,
    isRecurring: tx.isRecurring,
    tags: tx.tags,
    fileUrls: tx.fileUrls,
  }
  if (tx.type === 'transfer') {
    raw.toAccountId = tx.toAccountId
    // Between accounts of one currency the target amount is the amount itself: leaving it out lets an
    // edit of the amount carry over. Only a cross-currency transfer has an amount of its own.
    if (tx.toCurrency !== tx.currency) raw.toAmountMinor = tx.toAmountMinor
  } else if (!(tx.accrual.mode === 'date' && tx.accrual.date === tx.paymentDate)) {
    raw.accrual = tx.accrual
  }
  if (tx.categoryId !== undefined) raw.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) raw.counterpartyId = tx.counterpartyId
  if (tx.description !== undefined) raw.description = tx.description
  if (tx.projectId !== undefined) raw.projectId = tx.projectId
  return raw
}

/** Applies a validated patch onto the editable fields and revalidates the whole result. */
export function applyPatch(raw: RawInput, patch: TransactionPatch): TransactionInput {
  const merged: RawInput = { ...raw }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  return parseTransactionInput(merged)
}
```

- [ ] **Step 5: Verify input tests pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger/input.test.ts`
Expected: PASS. If `toMatchObject`/`toEqual` fails on key order or an `undefined` property, fix the implementation (never emit `undefined` properties).

- [ ] **Step 6: Write the failing build/fx tests**

`tests/unit/domain/ledger/build.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { attachFx, baseOf, buildTransaction, fxPlan, type BuildContext } from '@/lib/domain/ledger/build'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { RateEvidence } from '@/lib/domain/ledger/types'

const PLN = { id: 'pln', currency: 'PLN' }
const EUR = { id: 'eur', currency: 'EUR' }
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
  today: '2026-10-27',
  account: PLN,
  category: null,
  baseCurrency: 'PLN',
  ...over,
})
const input = (over: Record<string, unknown> = {}) =>
  parseTransactionInput({ type: 'expense', accountId: 'pln', amountMinor: 10000, paymentDate: '2026-10-20', ...over })

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'none'
}

const evidence = (rate: number, requestedDate: string): RateEvidence => ({
  rate, from: 'EUR', to: 'PLN', requestedDate, rateDate: '2026-10-19', tableNo: '203/A/NBP/2026', source: 'NBP_A',
})

describe('buildTransaction', () => {
  it('takes the currency from the account', () => {
    const tx = buildTransaction('t1', input(), ctx())
    expect(tx).toMatchObject({ id: 't1', currency: 'PLN', amountMinor: 10000, status: 'actual' })
  })

  it('refuses an actual operation after today, allows a planned one', () => {
    expect(code(() => buildTransaction('t', input({ paymentDate: '2026-10-28' }), ctx()))).toBe('future_actual:paymentDate')
    expect(buildTransaction('t', input({ paymentDate: '2026-10-28', status: 'planned' }), ctx()).status).toBe('planned')
  })

  it('refuses a date more than 10 years ahead', () => {
    expect(code(() => buildTransaction('t', input({ paymentDate: '2040-01-01', status: 'planned' }), ctx()))).toBe('invalid_input:paymentDate')
    expect(code(() => buildTransaction('t', input({ accrual: { mode: 'period', from: '2026-10-01', to: '2040-01-01' } }), ctx()))).toBe('invalid_input:accrual')
  })

  it('checks that the category exists and matches the type', () => {
    expect(code(() => buildTransaction('t', input({ categoryId: 'c1' }), ctx()))).toBe('category_not_found:categoryId')
    expect(code(() => buildTransaction('t', input({ categoryId: 'c1' }), ctx({ category: { type: 'income' } })))).toBe('category_not_found:categoryId')
    expect(buildTransaction('t', input({ categoryId: 'c1' }), ctx({ category: { type: 'expense' } })).categoryId).toBe('c1')
  })

  it('builds a same-currency transfer with the same amount on both sides', () => {
    const t = parseTransactionInput({ type: 'transfer', accountId: 'pln', toAccountId: 'pln2', amountMinor: 500, paymentDate: '2026-10-20' })
    const tx = buildTransaction('t', t, ctx({ toAccount: { id: 'pln2', currency: 'PLN' } }))
    expect(tx).toMatchObject({ toAccountId: 'pln2', toAmountMinor: 500, toCurrency: 'PLN' })
  })

  it('requires the second amount for a cross-currency transfer and rejects a mismatch for the same currency', () => {
    const base = { type: 'transfer', accountId: 'pln', toAccountId: 'eur', amountMinor: 4400, paymentDate: '2026-10-20' }
    expect(code(() => buildTransaction('t', parseTransactionInput(base), ctx({ toAccount: EUR })))).toBe('invalid_input:toAmountMinor')
    const ok = buildTransaction('t', parseTransactionInput({ ...base, toAmountMinor: 1000 }), ctx({ toAccount: EUR }))
    expect(ok).toMatchObject({ toAmountMinor: 1000, toCurrency: 'EUR' })
    const same = { ...base, toAccountId: 'pln2', toAmountMinor: 5 }
    expect(code(() => buildTransaction('t', parseTransactionInput(same), ctx({ toAccount: { id: 'pln2', currency: 'PLN' } })))).toBe('invalid_input:toAmountMinor')
  })

  it('refuses a transfer to the same account or without the target account', () => {
    const t = parseTransactionInput({ type: 'transfer', accountId: 'pln', toAccountId: 'pln', amountMinor: 5, paymentDate: '2026-10-20' })
    expect(code(() => buildTransaction('t', t, ctx({ toAccount: PLN })))).toBe('invalid_input:toAccountId')
    expect(code(() => buildTransaction('t', t, ctx()))).toBe('account_not_found:toAccountId')
  })
})

describe('fxPlan / attachFx / baseOf', () => {
  const eurCtx = ctx({ account: EUR })
  const eurTx = (over: Record<string, unknown> = {}) => buildTransaction('t', input({ accountId: 'eur', amountMinor: 1000, ...over }), eurCtx)

  it('needs no rates for the company currency, transfers and planned operations', () => {
    expect(fxPlan(buildTransaction('t', input(), ctx()), 'PLN', '2026-10-27')).toEqual([])
    expect(fxPlan(eurTx({ status: 'planned' }), 'PLN', '2026-10-27')).toEqual([])
  })

  it('asks one rate when the dates coincide', () => {
    expect(fxPlan(eurTx(), 'PLN', '2026-10-27')).toEqual([{ keys: ['payment', 'accrual'], from: 'EUR', to: 'PLN', date: '2026-10-20' }])
  })

  it('asks two rates when the accrual date differs, and caps the accrual date at today', () => {
    const plan = fxPlan(eurTx({ accrual: { mode: 'date', date: '2026-10-10' } }), 'PLN', '2026-10-27')
    expect(plan).toEqual([
      { keys: ['payment'], from: 'EUR', to: 'PLN', date: '2026-10-20' },
      { keys: ['accrual'], from: 'EUR', to: 'PLN', date: '2026-10-10' },
    ])
    const future = fxPlan(eurTx({ accrual: { mode: 'period', from: '2026-11-01', to: '2026-12-31' } }), 'PLN', '2026-10-27')
    expect(future[1]).toEqual({ keys: ['accrual'], from: 'EUR', to: 'PLN', date: '2026-10-27' })
  })

  it('attachFx stores the evidence and the base amounts', () => {
    const tx = eurTx({ accrual: { mode: 'date', date: '2026-10-10' } })
    const plan = fxPlan(tx, 'PLN', '2026-10-27')
    const out = attachFx(tx, plan, [evidence(4.4026, '2026-10-20'), evidence(4.3, '2026-10-10')])
    expect(out.base).toEqual({ payment: 4403, accrual: 4300 })
    expect(out.fx?.payment?.rate).toBe(4.4026)
    expect(out.fx?.accrual?.rate).toBe(4.3)
  })

  it('attachFx with an empty plan clears fx and base', () => {
    const tx = { ...eurTx(), fx: { payment: evidence(4, 'x') }, base: { payment: 1, accrual: 1 } }
    const out = attachFx(tx, [], [])
    expect(out).not.toHaveProperty('fx')
    expect(out).not.toHaveProperty('base')
  })

  it('baseOf is the amount itself in the company currency and null when base amounts are missing', () => {
    expect(baseOf(buildTransaction('t', input(), ctx()), 'PLN')).toEqual({ payment: 10000, accrual: 10000 })
    expect(baseOf(eurTx(), 'PLN')).toBeNull()
  })
})
```

- [ ] **Step 7: Write `build.ts`**

```ts
import { addDays } from './days'
import { LedgerError } from './errors'
import { bad } from './guards'
import type { TransactionInput } from './input'
import { mulRate } from './money'
import type { Base, Fx, LedgerTransaction, RateEvidence } from './types'

/** Operations may be planned at most this many days ahead. */
export const MAX_FUTURE_DAYS = 3650

export interface AccountRef {
  id: string
  currency: string
}

export interface BuildContext {
  /** The Warsaw day, supplied by the caller. */
  today: string
  account: AccountRef
  toAccount?: AccountRef
  /** The category document the request names, or null when it does not exist / none was named. */
  category: { type: 'income' | 'expense' } | null
  baseCurrency: string
}

export function buildTransaction(id: string, input: TransactionInput, ctx: BuildContext): LedgerTransaction {
  if (input.accountId !== ctx.account.id) throw new LedgerError('account_not_found', 'accountId')

  const horizon = addDays(ctx.today, MAX_FUTURE_DAYS)
  if (input.status === 'actual' && input.paymentDate > ctx.today) throw new LedgerError('future_actual', 'paymentDate')
  if (input.paymentDate > horizon) bad('paymentDate')
  const accrualEnd = input.accrual.mode === 'date' ? input.accrual.date : input.accrual.to
  if (accrualEnd > horizon) bad('accrual')

  if (input.type !== 'transfer' && input.categoryId !== undefined) {
    if (ctx.category === null || ctx.category.type !== input.type) throw new LedgerError('category_not_found', 'categoryId')
  }

  const tx: LedgerTransaction = {
    id,
    type: input.type,
    status: input.status,
    accountId: input.accountId,
    amountMinor: input.amountMinor,
    currency: ctx.account.currency,
    paymentDate: input.paymentDate,
    accrual: input.accrual,
    isRecurring: input.isRecurring,
    tags: input.tags,
    fileUrls: input.fileUrls,
  }
  if (input.categoryId !== undefined) tx.categoryId = input.categoryId
  if (input.counterpartyId !== undefined) tx.counterpartyId = input.counterpartyId
  if (input.description !== undefined) tx.description = input.description
  if (input.projectId !== undefined) tx.projectId = input.projectId

  if (input.type === 'transfer') {
    const to = ctx.toAccount
    if (!to || to.id !== input.toAccountId) throw new LedgerError('account_not_found', 'toAccountId')
    if (to.id === ctx.account.id) bad('toAccountId')
    tx.toAccountId = to.id
    tx.toCurrency = to.currency
    if (to.currency === ctx.account.currency) {
      if (input.toAmountMinor !== undefined && input.toAmountMinor !== input.amountMinor) bad('toAmountMinor')
      tx.toAmountMinor = input.amountMinor
    } else {
      if (input.toAmountMinor === undefined) bad('toAmountMinor')
      tx.toAmountMinor = input.toAmountMinor
    }
  }
  return tx
}

export type FxKey = 'payment' | 'accrual'

export interface FxRequest {
  keys: FxKey[]
  from: string
  to: string
  date: string
}

/**
 * The rates an operation needs: only an actual income/expense in a currency other than the company's.
 * The payment rate is for the payment date; the accrual rate is for the accrual date (a period's start),
 * capped at today so a stored snapshot is always final.
 */
export function fxPlan(tx: LedgerTransaction, baseCurrency: string, today: string): FxRequest[] {
  if (tx.status !== 'actual' || tx.type === 'transfer' || tx.currency === baseCurrency) return []
  const anchor = tx.accrual.mode === 'date' ? tx.accrual.date : tx.accrual.from
  const accrualDate = anchor > today ? today : anchor
  const common = { from: tx.currency, to: baseCurrency }
  if (accrualDate === tx.paymentDate) return [{ keys: ['payment', 'accrual'], ...common, date: tx.paymentDate }]
  return [
    { keys: ['payment'], ...common, date: tx.paymentDate },
    { keys: ['accrual'], ...common, date: accrualDate },
  ]
}

/** Stores the resolved evidence (one per request of `plan`, same order) and the base amounts. */
export function attachFx(tx: LedgerTransaction, plan: FxRequest[], evidence: RateEvidence[]): LedgerTransaction {
  const { fx: _fx, base: _base, ...rest } = tx
  void _fx
  void _base
  if (plan.length === 0) return rest
  const fx: Fx = {}
  const base: Partial<Base> = {}
  plan.forEach((request, i) => {
    for (const key of request.keys) {
      fx[key] = evidence[i]
      base[key] = mulRate(tx.amountMinor, evidence[i].rate)
    }
  })
  return { ...rest, fx, base: base as Base }
}

/** The amounts in the company currency, or null when an operation in another currency lacks them. */
export function baseOf(tx: LedgerTransaction, baseCurrency: string): Base | null {
  if (tx.currency === baseCurrency) return { payment: tx.amountMinor, accrual: tx.amountMinor }
  return tx.base ?? null
}
```

If the repo's ESLint flags the `void _fx` workaround, replace it with an explicit rebuild: copy `tx` into a new object field by field without `fx`/`base` instead.

- [ ] **Step 8: Write the failing entity-input tests**

`tests/unit/domain/ledger/entity-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseAccountInput, parseAccountPatch, parseOrgPatch } from '@/lib/domain/ledger/entity-input'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'none'
}

const ACC = { name: ' Main ', type: 'bank', currency: 'PLN', color: '#00c896', openingMinor: 12345 }

describe('parseAccountInput', () => {
  it('trims the name and keeps a negative opening balance', () => {
    expect(parseAccountInput(ACC)).toEqual({ ...ACC, name: 'Main' })
    expect(parseAccountInput({ ...ACC, openingMinor: -500 }).openingMinor).toBe(-500)
  })

  it.each([
    ['no name', { ...ACC, name: ' ' }, 'invalid_input:name'],
    ['a long name', { ...ACC, name: 'x'.repeat(121) }, 'invalid_input:name'],
    ['a bad type', { ...ACC, type: 'wallet' }, 'invalid_input:type'],
    ['a bad currency', { ...ACC, currency: 'GBP' }, 'invalid_input:currency'],
    ['a bad color', { ...ACC, color: 'green' }, 'invalid_input:color'],
    ['a fractional opening', { ...ACC, openingMinor: 1.5 }, 'invalid_input:openingMinor'],
    ['an unknown key', { ...ACC, balanceMinor: 5 }, 'invalid_input:balanceMinor'],
  ])('rejects %s', (_l, body, expected) => {
    expect(code(() => parseAccountInput(body))).toBe(expected)
  })
})

describe('parseAccountPatch', () => {
  it('accepts a subset and needs at least one key', () => {
    expect(parseAccountPatch({ name: 'B', openingMinor: 0 })).toEqual({ name: 'B', openingMinor: 0 })
    expect(code(() => parseAccountPatch({}))).toBe('invalid_input:body')
  })
})

describe('parseOrgPatch', () => {
  it('accepts name and/or currency', () => {
    expect(parseOrgPatch({ name: ' Acme ' })).toEqual({ name: 'Acme' })
    expect(parseOrgPatch({ currency: 'EUR' })).toEqual({ currency: 'EUR' })
    expect(code(() => parseOrgPatch({ currency: 'GBP' }))).toBe('invalid_input:currency')
    expect(code(() => parseOrgPatch({}))).toBe('invalid_input:body')
    expect(code(() => parseOrgPatch({ plan: 'pro' }))).toBe('invalid_input:plan')
  })
})
```

- [ ] **Step 9: Write `entity-input.ts`**

```ts
import { asRecord, bad, onlyKeys } from './guards'
import { MAX_MINOR, isMinor } from './money'
import { ACCOUNT_TYPES, LEDGER_CURRENCIES, type AccountType } from './types'

const ACCOUNT_KEYS = ['name', 'type', 'currency', 'color', 'openingMinor'] as const
const COLOR = /^#[0-9a-fA-F]{6}$/
const NAME_MAX = 120

export interface AccountInput {
  name: string
  type: AccountType
  currency: string
  color: string
  openingMinor: number
}

export type AccountPatch = Partial<AccountInput>

export interface OrgPatch {
  name?: string
  currency?: string
}

function name(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.trim()
  if (text.length < 1 || text.length > NAME_MAX) bad('name')
  return text
}

function pick(r: Record<string, unknown>, key: (typeof ACCOUNT_KEYS)[number]): unknown {
  switch (key) {
    case 'name':
      return name(r.name)
    case 'type':
      if (!(ACCOUNT_TYPES as readonly unknown[]).includes(r.type)) bad('type')
      return r.type
    case 'currency':
      if (!(LEDGER_CURRENCIES as readonly unknown[]).includes(r.currency)) bad('currency')
      return r.currency
    case 'color':
      if (typeof r.color !== 'string' || !COLOR.test(r.color)) bad('color')
      return r.color
    case 'openingMinor':
      if (!isMinor(r.openingMinor) || Math.abs(r.openingMinor) > MAX_MINOR) bad('openingMinor')
      return r.openingMinor
  }
}

export function parseAccountInput(body: unknown): AccountInput {
  const r = asRecord(body)
  onlyKeys(r, ACCOUNT_KEYS)
  for (const key of ACCOUNT_KEYS) if (r[key] === undefined) bad(key)
  return Object.fromEntries(ACCOUNT_KEYS.map((key) => [key, pick(r, key)])) as unknown as AccountInput
}

export function parseAccountPatch(body: unknown): AccountPatch {
  const r = asRecord(body)
  onlyKeys(r, ACCOUNT_KEYS)
  const keys = ACCOUNT_KEYS.filter((key) => r[key] !== undefined)
  if (keys.length === 0) bad('body')
  return Object.fromEntries(keys.map((key) => [key, pick(r, key)])) as AccountPatch
}

export function parseOrgPatch(body: unknown): OrgPatch {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'currency'])
  if (r.name === undefined && r.currency === undefined) bad('body')
  const out: OrgPatch = {}
  if (r.name !== undefined) out.name = name(r.name)
  if (r.currency !== undefined) {
    if (!(LEDGER_CURRENCIES as readonly unknown[]).includes(r.currency)) bad('currency')
    out.currency = r.currency as string
  }
  return out
}
```

- [ ] **Step 10: Verify and commit**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger` and `npm run typecheck` and `npm run lint`
Expected: PASS, no new lint errors.

```bash
git add -A
git commit -m "feat(ledger): input parsing, validation, fx planning

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Domain documents, effects, rollups, change sets, expected ledger

**Model:** sonnet

**Files:**
- Create: `lib/domain/ledger/doc.ts`, `effects.ts`, `rollups.ts`, `change.ts`, `expected.ts`
- Create: `tests/unit/domain/ledger/doc.test.ts`, `effects.test.ts`, `rollups.test.ts`, `expected.test.ts`

- [ ] **Step 1: Write the failing document tests**

`tests/unit/domain/ledger/doc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { accountToDoc, parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'

const tx: LedgerTransaction = {
  id: 't1',
  type: 'expense',
  status: 'actual',
  accountId: 'a1',
  amountMinor: 1000,
  currency: 'EUR',
  paymentDate: '2026-10-20',
  accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
  categoryId: 'c1',
  description: 'rent',
  isRecurring: false,
  tags: ['x'],
  fileUrls: [],
  fx: {
    payment: { rate: 4.4, from: 'EUR', to: 'PLN', requestedDate: '2026-10-20', rateDate: '2026-10-19', tableNo: '1/A/NBP/2026', source: 'NBP_A' },
    accrual: { rate: 4.3, from: 'EUR', to: 'PLN', requestedDate: '2026-10-01', rateDate: '2026-09-30', tableNo: '2/A/NBP/2026', source: 'NBP_A' },
  },
  base: { payment: 4400, accrual: 4300 },
}

describe('transaction documents', () => {
  it('round-trips and never emits undefined', () => {
    const doc = transactionToDoc(tx)
    expect(doc.schemaVersion).toBe(2)
    expect(Object.values(doc).includes(undefined)).toBe(false)
    expect(parseTransaction('t1', doc)).toEqual(tx)
  })

  it('round-trips a transfer and ignores counterpartyId on it', () => {
    const t: LedgerTransaction = {
      id: 't2', type: 'transfer', status: 'actual', accountId: 'a', amountMinor: 4400, currency: 'PLN',
      toAccountId: 'b', toAmountMinor: 1000, toCurrency: 'EUR', paymentDate: '2026-10-20',
      accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
    }
    const doc = { ...transactionToDoc(t), counterpartyId: 'legacy-to-account' }
    expect(parseTransaction('t2', doc)).toEqual(t)
  })

  it.each([
    ['schema 1', { schemaVersion: 1 }],
    ['no schema', { schemaVersion: undefined }],
    ['a bad type', { type: 'x' }],
    ['a fractional amount', { amountMinor: 1.5 }],
    ['a bad date', { paymentDate: '2026-13-01' }],
    ['a bad accrual', { accrual: { mode: 'date' } }],
    ['a transfer without a target', { type: 'transfer', toAccountId: undefined }],
  ])('returns null for %s', (_l, patch) => {
    expect(parseTransaction('t1', { ...transactionToDoc(tx), ...patch })).toBeNull()
  })

  it('returns null for a non-object', () => {
    expect(parseTransaction('t1', null)).toBeNull()
    expect(parseTransaction('t1', 'x')).toBeNull()
  })
})

describe('account documents', () => {
  const acc: LedgerAccount = { id: 'a1', name: 'Main', type: 'bank', currency: 'PLN', color: '#00c896', openingMinor: 100, balanceMinor: 250 }
  it('round-trips', () => {
    expect(parseAccount('a1', accountToDoc(acc))).toEqual(acc)
  })
  it('returns null for a legacy account', () => {
    expect(parseAccount('a1', { name: 'x', balance: 5, currency: 'PLN' })).toBeNull()
  })
})
```

- [ ] **Step 2: Write `doc.ts`**

```ts
import { isDay } from './days'
import { isMinor } from './money'
import {
  ACCOUNT_TYPES,
  TX_STATUSES,
  TX_TYPES,
  type Accrual,
  type Base,
  type Fx,
  type LedgerAccount,
  type LedgerTransaction,
  type RateEvidence,
} from './types'

export const SCHEMA_VERSION = 2

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null
}

function optionalString(v: unknown): string | undefined | null {
  if (v === undefined) return undefined
  return typeof v === 'string' ? v : null
}

function parseAccrual(v: unknown): Accrual | null {
  if (!isRecord(v)) return null
  if (v.mode === 'date' && isDay(v.date)) return { mode: 'date', date: v.date }
  if (v.mode === 'period' && isDay(v.from) && isDay(v.to)) return { mode: 'period', from: v.from, to: v.to }
  return null
}

function parseEvidence(v: unknown): RateEvidence | null {
  if (!isRecord(v)) return null
  const { rate, from, to, requestedDate, rateDate, tableNo, source } = v
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  if (typeof from !== 'string' || typeof to !== 'string') return null
  if (!isDay(requestedDate) || !isDay(rateDate)) return null
  if (tableNo !== null && typeof tableNo !== 'string') return null
  if (source !== 'NBP_A' && source !== 'identity') return null
  return { rate, from, to, requestedDate, rateDate, tableNo, source }
}

/** The stored fields of an operation (no id, no server timestamps). Never contains `undefined`. */
export function transactionToDoc(tx: LedgerTransaction): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    paymentDate: tx.paymentDate,
    accrual: tx.accrual,
    isRecurring: tx.isRecurring,
    tags: tx.tags,
    fileUrls: tx.fileUrls,
    schemaVersion: SCHEMA_VERSION,
  }
  if (tx.toAccountId !== undefined) doc.toAccountId = tx.toAccountId
  if (tx.toAmountMinor !== undefined) doc.toAmountMinor = tx.toAmountMinor
  if (tx.toCurrency !== undefined) doc.toCurrency = tx.toCurrency
  if (tx.categoryId !== undefined) doc.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) doc.counterpartyId = tx.counterpartyId
  if (tx.description !== undefined) doc.description = tx.description
  if (tx.projectId !== undefined) doc.projectId = tx.projectId
  if (tx.fx !== undefined) doc.fx = tx.fx
  if (tx.base !== undefined) doc.base = tx.base
  return doc
}

/** A v2 operation document, or null when it is not one or is malformed (schema 1 documents are null). */
export function parseTransaction(id: string, data: unknown): LedgerTransaction | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION) return null
  const { type, status, accountId, amountMinor, currency, paymentDate, isRecurring } = data
  if (!(TX_TYPES as readonly unknown[]).includes(type) || !(TX_STATUSES as readonly unknown[]).includes(status)) return null
  if (typeof accountId !== 'string' || !isMinor(amountMinor) || amountMinor <= 0 || typeof currency !== 'string') return null
  if (!isDay(paymentDate) || typeof isRecurring !== 'boolean') return null
  const accrual = parseAccrual(data.accrual)
  const tags = stringArray(data.tags)
  const fileUrls = stringArray(data.fileUrls)
  if (!accrual || !tags || !fileUrls) return null

  const tx: LedgerTransaction = {
    id,
    type: type as LedgerTransaction['type'],
    status: status as LedgerTransaction['status'],
    accountId,
    amountMinor,
    currency,
    paymentDate,
    accrual,
    isRecurring,
    tags,
    fileUrls,
  }

  if (type === 'transfer') {
    if (typeof data.toAccountId !== 'string' || !isMinor(data.toAmountMinor) || data.toAmountMinor <= 0) return null
    if (typeof data.toCurrency !== 'string') return null
    tx.toAccountId = data.toAccountId
    tx.toAmountMinor = data.toAmountMinor
    tx.toCurrency = data.toCurrency
  } else {
    const counterpartyId = optionalString(data.counterpartyId)
    if (counterpartyId === null) return null
    if (counterpartyId !== undefined) tx.counterpartyId = counterpartyId
  }

  for (const key of ['categoryId', 'description', 'projectId'] as const) {
    const value = optionalString(data[key])
    if (value === null) return null
    if (value !== undefined) tx[key] = value
  }

  if (data.fx !== undefined) {
    if (!isRecord(data.fx)) return null
    const fx: Fx = {}
    for (const key of ['payment', 'accrual'] as const) {
      if (data.fx[key] === undefined) continue
      const evidence = parseEvidence(data.fx[key])
      if (!evidence) return null
      fx[key] = evidence
    }
    tx.fx = fx
  }
  if (data.base !== undefined) {
    if (!isRecord(data.base) || !isMinor(data.base.payment) || !isMinor(data.base.accrual)) return null
    const base: Base = { payment: data.base.payment, accrual: data.base.accrual }
    tx.base = base
  }
  return tx
}

export function accountToDoc(a: LedgerAccount): Record<string, unknown> {
  return {
    name: a.name,
    type: a.type,
    currency: a.currency,
    color: a.color,
    openingMinor: a.openingMinor,
    balanceMinor: a.balanceMinor,
    schemaVersion: SCHEMA_VERSION,
  }
}

/** A v2 account document, or null (legacy accounts, which have `balance` only, are null). */
export function parseAccount(id: string, data: unknown): LedgerAccount | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION) return null
  const { name, type, currency, color, openingMinor, balanceMinor } = data
  if (typeof name !== 'string' || typeof currency !== 'string' || typeof color !== 'string') return null
  if (!(ACCOUNT_TYPES as readonly unknown[]).includes(type)) return null
  if (!isMinor(openingMinor) || !isMinor(balanceMinor)) return null
  return { id, name, type: type as LedgerAccount['type'], currency, color, openingMinor, balanceMinor }
}
```

- [ ] **Step 3: Write the failing effects/rollups tests**

`tests/unit/domain/ledger/effects.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { balanceEffects, mergeEffects, negateEffects } from '@/lib/domain/ledger/effects'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 't', type: 'income', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [], ...over,
})

describe('balanceEffects', () => {
  it('income adds, expense subtracts', () => {
    expect(balanceEffects(tx({ type: 'income' }))).toEqual({ a: 1000 })
    expect(balanceEffects(tx({ type: 'expense' }))).toEqual({ a: -1000 })
  })
  it('a transfer moves the amounts between two accounts', () => {
    expect(balanceEffects(tx({ type: 'transfer', toAccountId: 'b', toAmountMinor: 230, toCurrency: 'EUR' }))).toEqual({ a: -1000, b: 230 })
  })
  it('a planned operation has no effect', () => {
    expect(balanceEffects(tx({ status: 'planned' }))).toEqual({})
  })
})

describe('mergeEffects / negateEffects', () => {
  it('sums per account and drops zeros', () => {
    expect(mergeEffects({ a: 5, b: 1 }, { a: -5, c: 2 })).toEqual({ b: 1, c: 2 })
  })
  it('negates', () => {
    expect(negateEffects({ a: 5, b: -2 })).toEqual({ a: -5, b: 2 })
  })
})
```

`tests/unit/domain/ledger/rollups.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { changeSet } from '@/lib/domain/ledger/change'
import { addInto, cashCatDocId, cashDocId, contributions, diffRollups, flatten, nest, plDocId, type RollupDocs } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 't', type: 'expense', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, categoryId: 'cat', isRecurring: false, tags: [], fileUrls: [], ...over,
})

const plain = (docs: RollupDocs) => Object.fromEntries(docs)

describe('contributions', () => {
  it('an expense in the company currency touches cash, cashcat and pl', () => {
    expect(plain(contributions(tx({}), 'PLN'))).toEqual({
      [cashDocId('a', '2026-10-20')]: { outMinor: 1000, outBase: 1000 },
      [cashCatDocId('2026-10')]: { 'categories.cat.expenseBase': 1000 },
      [plDocId('2026-10')]: { 'categories.cat.expenseBase': 1000 },
    })
  })

  it('income without a category goes to _none; sign -1 negates', () => {
    const t = tx({ type: 'income', categoryId: undefined })
    expect(plain(contributions(t, 'PLN', -1))[plDocId('2026-10')]).toEqual({ 'categories._none.incomeBase': -1000 })
  })

  it('uses base amounts for another currency and the accrual date for pl', () => {
    const t = tx({
      currency: 'EUR',
      accrual: { mode: 'date', date: '2026-09-15' },
      base: { payment: 4400, accrual: 4300 },
    })
    const docs = plain(contributions(t, 'PLN'))
    expect(docs[cashDocId('a', '2026-10-20')]).toEqual({ outMinor: 1000, outBase: 4400 })
    expect(docs[cashCatDocId('2026-10')]).toEqual({ 'categories.cat.expenseBase': 4400 })
    expect(docs[plDocId('2026-09')]).toEqual({ 'categories.cat.expenseBase': 4300 })
    expect(docs[plDocId('2026-10')]).toBeUndefined()
  })

  it('spreads a period over the months of pl', () => {
    const t = tx({ amountMinor: 1000, accrual: { mode: 'period', from: '2026-01-15', to: '2026-03-02' } })
    const docs = plain(contributions(t, 'PLN'))
    expect(docs[plDocId('2026-01')]).toEqual({ 'categories.cat.expenseBase': 361 })
    expect(docs[plDocId('2026-02')]).toEqual({ 'categories.cat.expenseBase': 595 })
    expect(docs[plDocId('2026-03')]).toEqual({ 'categories.cat.expenseBase': 44 })
  })

  it('a transfer is only cash movement on the two accounts', () => {
    const t = tx({ type: 'transfer', categoryId: undefined, toAccountId: 'b', toAmountMinor: 230, toCurrency: 'EUR' })
    expect(plain(contributions(t, 'PLN'))).toEqual({
      [cashDocId('a', '2026-10-20')]: { transferOutMinor: 1000 },
      [cashDocId('b', '2026-10-20')]: { transferInMinor: 230 },
    })
  })

  it('a planned operation contributes nothing', () => {
    expect(contributions(tx({ status: 'planned' }), 'PLN').size).toBe(0)
  })

  it('throws for an operation in another currency without base amounts', () => {
    expect(() => contributions(tx({ currency: 'EUR' }), 'PLN')).toThrow()
  })
})

describe('addInto', () => {
  it('sums, and removes entries that reach zero', () => {
    const target: RollupDocs = new Map()
    addInto(target, contributions(tx({}), 'PLN'))
    addInto(target, contributions(tx({}), 'PLN', -1))
    expect(target.size).toBe(0)
  })
})

describe('nest / flatten', () => {
  it('round-trips dotted fields', () => {
    const flat = { inMinor: 5, 'categories.c1.incomeBase': 7, 'categories.c2.expenseBase': -3 }
    const nested = nest(flat)
    expect(nested).toEqual({ inMinor: 5, categories: { c1: { incomeBase: 7 }, c2: { expenseBase: -3 } } })
    expect(flatten(nested)).toEqual(flat)
  })
  it('maps leaves', () => {
    expect(nest({ a: 2 }, (n) => ({ inc: n }))).toEqual({ a: { inc: 2 } })
  })
})

describe('diffRollups', () => {
  it('treats a missing document and zero fields as equal and reports real differences', () => {
    const a: RollupDocs = new Map([['x', { f: 1, z: 0 }]])
    const b: RollupDocs = new Map([['x', { f: 1 }]])
    expect(diffRollups(a, b)).toEqual([])
    const c: RollupDocs = new Map([['y', { f: 2 }]])
    expect(diffRollups(a, c)).toEqual([
      { docId: 'x', field: 'f', stored: 1, expected: 0 },
      { docId: 'y', field: 'f', stored: 0, expected: 2 },
    ])
  })
})

describe('changeSet', () => {
  it('create is +new, delete is -old, update is both', () => {
    const t = tx({})
    const create = changeSet(null, t, 'PLN')
    expect(create.balanceDeltas).toEqual({ a: -1000 })
    const del = changeSet(t, null, 'PLN')
    expect(del.balanceDeltas).toEqual({ a: 1000 })
    const edited = tx({ amountMinor: 1100 })
    const update = changeSet(t, edited, 'PLN')
    expect(update.balanceDeltas).toEqual({ a: -100 })
    expect(plain(update.rollupDeltas)[cashDocId('a', '2026-10-20')]).toEqual({ outMinor: 100, outBase: 100 })
  })
  it('moving an operation to another account and date rebalances both', () => {
    const t = tx({})
    const moved = tx({ accountId: 'b', paymentDate: '2026-10-21', accrual: { mode: 'date', date: '2026-10-21' } })
    expect(changeSet(t, moved, 'PLN').balanceDeltas).toEqual({ a: 1000, b: -1000 })
  })
})
```

- [ ] **Step 4: Write `effects.ts`, `rollups.ts`, `change.ts`, `expected.ts`**

`lib/domain/ledger/effects.ts`:

```ts
import type { LedgerTransaction } from './types'

/** Change of each account balance (minor units) caused by an operation. Planned operations have none. */
export function balanceEffects(tx: LedgerTransaction): Record<string, number> {
  if (tx.status !== 'actual') return {}
  switch (tx.type) {
    case 'income':
      return { [tx.accountId]: tx.amountMinor }
    case 'expense':
      return { [tx.accountId]: -tx.amountMinor }
    case 'transfer':
      return { [tx.accountId]: -tx.amountMinor, [tx.toAccountId as string]: tx.toAmountMinor as number }
  }
}

export function mergeEffects(...parts: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of parts) {
    for (const [id, delta] of Object.entries(part)) out[id] = (out[id] ?? 0) + delta
  }
  for (const id of Object.keys(out)) if (out[id] === 0) delete out[id]
  return out
}

export function negateEffects(effects: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(effects).map(([id, delta]) => [id, delta === 0 ? 0 : -delta]))
}
```

`lib/domain/ledger/rollups.ts`:

```ts
import { monthOf } from './days'
import { baseOf } from './build'
import { allocatePeriod } from './period'
import type { LedgerTransaction } from './types'

export const NO_CATEGORY = '_none'

/** One rollup document as flat dotted fields, e.g. `inMinor` or `categories.<id>.incomeBase`. */
export type RollupFlat = Record<string, number>
/** Rollup documents by id. A document or field whose value is 0 is simply absent. */
export type RollupDocs = Map<string, RollupFlat>

export const cashDocId = (accountId: string, day: string) => `cash_${accountId}_${day}`
export const cashCatDocId = (month: string) => `cashcat_${month}`
export const plDocId = (month: string) => `pl_${month}`

function bump(docs: RollupDocs, id: string, field: string, delta: number): void {
  if (delta === 0) return
  const flat = docs.get(id) ?? {}
  const next = (flat[field] ?? 0) + delta
  if (next === 0) delete flat[field]
  else flat[field] = next
  if (Object.keys(flat).length === 0) docs.delete(id)
  else docs.set(id, flat)
}

/** Adds `source` into `target`; entries that reach 0 disappear. */
export function addInto(target: RollupDocs, source: RollupDocs): void {
  for (const [id, flat] of source) {
    for (const [field, delta] of Object.entries(flat)) bump(target, id, field, delta)
  }
}

/**
 * What one operation adds to the rollups (times `sign`):
 *  - cash_{account}_{paymentDay}: in/out in the account currency and in the company currency; transfer in/out;
 *  - cashcat_{paymentMonth}: per category, company currency;
 *  - pl_{accrualMonth}: per category, company currency, a period spread over its months.
 * Planned operations contribute nothing. Throws when an operation in another currency has no base amounts.
 */
export function contributions(tx: LedgerTransaction, baseCurrency: string, sign: 1 | -1 = 1): RollupDocs {
  const docs: RollupDocs = new Map()
  if (tx.status !== 'actual') return docs

  if (tx.type === 'transfer') {
    bump(docs, cashDocId(tx.accountId, tx.paymentDate), 'transferOutMinor', sign * tx.amountMinor)
    bump(docs, cashDocId(tx.toAccountId as string, tx.paymentDate), 'transferInMinor', sign * (tx.toAmountMinor as number))
    return docs
  }

  const base = baseOf(tx, baseCurrency)
  if (!base) throw new Error(`operation ${tx.id} has no base amounts`)
  const income = tx.type === 'income'
  const category = tx.categoryId ?? NO_CATEGORY
  const field = `categories.${category}.${income ? 'incomeBase' : 'expenseBase'}`

  const cash = cashDocId(tx.accountId, tx.paymentDate)
  bump(docs, cash, income ? 'inMinor' : 'outMinor', sign * tx.amountMinor)
  bump(docs, cash, income ? 'inBase' : 'outBase', sign * base.payment)
  bump(docs, cashCatDocId(monthOf(tx.paymentDate)), field, sign * base.payment)

  const parts: Array<[string, number]> =
    tx.accrual.mode === 'date'
      ? [[monthOf(tx.accrual.date), base.accrual]]
      : allocatePeriod(base.accrual, tx.accrual.from, tx.accrual.to)
  for (const [month, value] of parts) bump(docs, plDocId(month), field, sign * value)
  return docs
}

/** Dotted flat fields to a nested object; `leaf` wraps each number (e.g. FieldValue.increment). */
export function nest(flat: RollupFlat, leaf: (n: number) => unknown = (n) => n): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, n] of Object.entries(flat)) {
    const keys = path.split('.')
    let cursor = out
    for (const key of keys.slice(0, -1)) {
      cursor = (cursor[key] ??= {}) as Record<string, unknown>
    }
    cursor[keys[keys.length - 1]] = leaf(n)
  }
  return out
}

/** The inverse of `nest` for stored documents; non-number leaves are ignored. */
export function flatten(nested: unknown, prefix = ''): RollupFlat {
  const out: RollupFlat = {}
  if (typeof nested !== 'object' || nested === null) return out
  for (const [key, value] of Object.entries(nested)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'number') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

export interface RollupDiff {
  docId: string
  field: string
  stored: number
  expected: number
}

/** Differences between two rollup sets; a missing document or field counts as 0. Sorted by doc, field. */
export function diffRollups(stored: RollupDocs, expected: RollupDocs): RollupDiff[] {
  const diffs: RollupDiff[] = []
  const ids = [...new Set([...stored.keys(), ...expected.keys()])].sort()
  for (const docId of ids) {
    const a = stored.get(docId) ?? {}
    const b = expected.get(docId) ?? {}
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const s = a[field] ?? 0
      const e = b[field] ?? 0
      if (s !== e) diffs.push({ docId, field, stored: s, expected: e })
    }
  }
  return diffs
}
```

`lib/domain/ledger/change.ts`:

```ts
import { balanceEffects, mergeEffects, negateEffects } from './effects'
import { addInto, contributions, type RollupDocs } from './rollups'
import type { LedgerTransaction } from './types'

export interface ChangeSet {
  /** Per account: change of `balanceMinor`. No zero entries. */
  balanceDeltas: Record<string, number>
  /** Per rollup document: increments (negative to take back). No zero entries. */
  rollupDeltas: RollupDocs
}

/**
 * The single rule for every write: create = +next, delete = -prior, update = -prior +next.
 * The server applies exactly this inside one transaction; the tests apply it to a model.
 */
export function changeSet(prior: LedgerTransaction | null, next: LedgerTransaction | null, baseCurrency: string): ChangeSet {
  const balanceDeltas = mergeEffects(
    next ? balanceEffects(next) : {},
    prior ? negateEffects(balanceEffects(prior)) : {},
  )
  const rollupDeltas: RollupDocs = new Map()
  if (next) addInto(rollupDeltas, contributions(next, baseCurrency, 1))
  if (prior) addInto(rollupDeltas, contributions(prior, baseCurrency, -1))
  return { balanceDeltas, rollupDeltas }
}
```

`lib/domain/ledger/expected.ts`:

```ts
import { baseOf } from './build'
import { balanceEffects } from './effects'
import { addInto, contributions, type RollupDocs } from './rollups'
import type { LedgerAccount, LedgerTransaction } from './types'

export interface ExpectedLedger {
  /** Per account id: opening + sum of the effects of its actual operations. */
  balances: Record<string, number>
  rollups: RollupDocs
  /** Ids of operations that cannot be counted (missing account, missing base amounts). */
  invalid: string[]
}

/** True when the operation can be turned into effects and contributions. */
function countable(tx: LedgerTransaction, baseCurrency: string, known: Record<string, number>): boolean {
  if (tx.status !== 'actual') return true
  if (!Object.keys(balanceEffects(tx)).every((id) => id in known)) return false
  return tx.type === 'transfer' || baseOf(tx, baseCurrency) !== null
}

/** The oracle: what balances and rollups must be, computed from scratch from the operations. */
export function computeLedger(accounts: LedgerAccount[], txs: LedgerTransaction[], baseCurrency: string): ExpectedLedger {
  const balances: Record<string, number> = Object.fromEntries(accounts.map((a) => [a.id, a.openingMinor]))
  const rollups: RollupDocs = new Map()
  const invalid: string[] = []
  for (const tx of txs) {
    if (!countable(tx, baseCurrency, balances)) {
      invalid.push(tx.id)
      continue
    }
    for (const [id, delta] of Object.entries(balanceEffects(tx))) balances[id] += delta
    addInto(rollups, contributions(tx, baseCurrency))
  }
  return { balances, rollups, invalid }
}
```

`build.ts` imports nothing from rollups, and `rollups.ts` imports `baseOf` from `build.ts` — no cycle.

- [ ] **Step 5: Write the failing expected-ledger test**

`tests/unit/domain/ledger/expected.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeLedger } from '@/lib/domain/ledger/expected'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'

const acc = (id: string, openingMinor: number, currency = 'PLN'): LedgerAccount => ({
  id, name: id, type: 'bank', currency, color: '#000000', openingMinor, balanceMinor: openingMinor,
})
const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 't', type: 'income', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [], ...over,
})

describe('computeLedger', () => {
  it('the screenshot case: 1234,60 of income, +10 and -10 ends at 1234,60', () => {
    const out = computeLedger(
      [acc('a', 0)],
      [tx({ id: '1', amountMinor: 123460 }), tx({ id: '2', amountMinor: 1000 }), tx({ id: '3', type: 'expense', amountMinor: 1000 })],
      'PLN',
    )
    expect(out.balances.a).toBe(123460)
  })

  it('counts a transfer on both accounts and ignores planned operations', () => {
    const out = computeLedger(
      [acc('a', 5000), acc('b', 0, 'EUR')],
      [
        tx({ id: '1', type: 'transfer', amountMinor: 4400, toAccountId: 'b', toAmountMinor: 1000, toCurrency: 'EUR' }),
        tx({ id: '2', status: 'planned', amountMinor: 999 }),
      ],
      'PLN',
    )
    expect(out.balances).toEqual({ a: 600, b: 1000 })
    expect(out.rollups.size).toBe(2)
  })

  it('reports operations it cannot count and leaves them out', () => {
    const out = computeLedger([acc('a', 0)], [tx({ id: 'x', accountId: 'ghost' }), tx({ id: 'y', currency: 'EUR' })], 'PLN')
    expect(out.invalid).toEqual(['x', 'y'])
    expect(out.balances).toEqual({ a: 0 })
  })
})
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger` and `npm run typecheck` and `npm run lint`
Expected: PASS.

```bash
git add -A
git commit -m "feat(ledger): documents, balance effects, rollup contributions, change sets, expected ledger

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Property tests of the domain algebra

**Model:** sonnet

**Files:**
- Create: `tests/unit/domain/ledger/model.ts` (shared generator and model), `tests/unit/domain/ledger/property.test.ts`

- [ ] **Step 1: Write the generator and the incremental model**

`tests/unit/domain/ledger/model.ts`:

```ts
import { attachFx, buildTransaction, fxPlan } from '@/lib/domain/ledger/build'
import { changeSet } from '@/lib/domain/ledger/change'
import { addDays } from '@/lib/domain/ledger/days'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { addInto, type RollupDocs } from '@/lib/domain/ledger/rollups'
import type { LedgerAccount, LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'

export const TODAY = '2026-10-27'
export const BASE = 'PLN'

export const ACCOUNTS: LedgerAccount[] = [
  { id: 'pln1', name: 'pln1', type: 'bank', currency: 'PLN', color: '#000000', openingMinor: 100000, balanceMinor: 100000 },
  { id: 'pln2', name: 'pln2', type: 'cash', currency: 'PLN', color: '#000000', openingMinor: 0, balanceMinor: 0 },
  { id: 'eur1', name: 'eur1', type: 'bank', currency: 'EUR', color: '#000000', openingMinor: 50000, balanceMinor: 50000 },
]

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

/** A deterministic fake NBP rate: depends on the currency and the date only. */
export function fakeEvidence(from: string, to: string, date: string): RateEvidence {
  const n = Number(date.replaceAll('-', '')) % 97
  const rate = from === 'EUR' && to === 'PLN' ? 4.2 + n / 100 : 1
  return { rate, from, to, requestedDate: date, rateDate: addDays(date, -1), tableNo: `${n}/A/NBP/2026`, source: 'NBP_A' }
}

/** A random valid operation with id `id`, or null when the random draw is not valid. */
export function randomTx(r: () => number, id: string): LedgerTransaction | null {
  const type = pick(r, ['income', 'expense', 'expense', 'income', 'transfer'] as const)
  const account = pick(r, ACCOUNTS)
  const planned = r() < 0.15
  const payment = addDays(TODAY, planned ? int(r, 1, 60) : -int(r, 0, 120))
  const input: Record<string, unknown> = {
    type,
    status: planned ? 'planned' : 'actual',
    accountId: account.id,
    amountMinor: int(r, 1, 500000),
    paymentDate: payment,
  }
  let toAccount
  if (type === 'transfer') {
    toAccount = pick(r, ACCOUNTS.filter((a) => a.id !== account.id))
    input.toAccountId = toAccount.id
    if (toAccount.currency !== account.currency) input.toAmountMinor = int(r, 1, 200000)
  } else {
    if (r() < 0.7) input.categoryId = pick(r, ['c1', 'c2', 'c3'])
    const kind = r()
    if (kind < 0.25) input.accrual = { mode: 'date', date: addDays(payment, -int(r, 1, 90)) }
    else if (kind < 0.5) {
      const from = addDays(payment, -int(r, 0, 60))
      input.accrual = { mode: 'period', from, to: addDays(from, int(r, 0, 400)) }
    }
  }
  try {
    const built = buildTransaction(id, parseTransactionInput(input), {
      today: TODAY,
      account,
      toAccount,
      category: input.categoryId ? { type: type as 'income' | 'expense' } : null,
      baseCurrency: BASE,
    })
    const plan = fxPlan(built, BASE, TODAY)
    return attachFx(built, plan, plan.map((p) => fakeEvidence(p.from, p.to, p.date)))
  } catch (e) {
    if (e instanceof LedgerError) return null
    throw e
  }
}

/** The state the server maintains incrementally; `apply` mirrors one write transaction. */
export class Model {
  readonly txs = new Map<string, LedgerTransaction>()
  readonly balances: Record<string, number> = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.openingMinor]))
  readonly rollups: RollupDocs = new Map()

  apply(prior: LedgerTransaction | null, next: LedgerTransaction | null): void {
    const change = changeSet(prior, next, BASE)
    for (const [id, delta] of Object.entries(change.balanceDeltas)) this.balances[id] += delta
    addInto(this.rollups, change.rollupDeltas)
    if (next) this.txs.set(next.id, next)
    else if (prior) this.txs.delete(prior.id)
  }
}
```

- [ ] **Step 2: Write the property test**

`tests/unit/domain/ledger/property.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { diffRollups } from '@/lib/domain/ledger/rollups'
import { ACCOUNTS, BASE, Model, randomTx, rng } from './model'

function checkAgainstOracle(model: Model): void {
  const oracle = computeLedger(ACCOUNTS, [...model.txs.values()], BASE)
  expect(oracle.invalid).toEqual([])
  expect(model.balances).toEqual(oracle.balances)
  expect(diffRollups(model.rollups, oracle.rollups)).toEqual([])
}

describe('ledger algebra (random create / update / delete sequences)', () => {
  it('incremental balances and rollups always equal the from-scratch computation', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed)
      const model = new Model()
      let nextId = 0
      for (let step = 0; step < 40; step++) {
        const ids = [...model.txs.keys()]
        const roll = r()
        if (roll < 0.6 || ids.length === 0) {
          const tx = randomTx(r, `t${nextId++}`)
          if (tx) model.apply(null, tx)
        } else if (roll < 0.85) {
          const id = ids[Math.floor(r() * ids.length)]
          const tx = randomTx(r, id)
          if (tx) model.apply(model.txs.get(id) ?? null, tx)
        } else {
          const id = ids[Math.floor(r() * ids.length)]
          model.apply(model.txs.get(id) ?? null, null)
        }
        checkAgainstOracle(model)
      }
    }
  })

  it('deleting everything returns balances to the opening values and leaves no rollups', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(1000 + seed)
      const model = new Model()
      for (let i = 0; i < 25; i++) {
        const tx = randomTx(r, `t${i}`)
        if (tx) model.apply(null, tx)
      }
      for (const tx of [...model.txs.values()]) model.apply(tx, null)
      expect(model.balances).toEqual(Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.openingMinor])))
      expect(model.rollups.size).toBe(0)
    }
  })

  it('an update equals a delete followed by a create', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(5000 + seed)
      const first = randomTx(r, 't')
      const second = randomTx(r, 't')
      if (!first || !second) continue
      const direct = new Model()
      direct.apply(null, first)
      direct.apply(first, second)
      const stepwise = new Model()
      stepwise.apply(null, first)
      stepwise.apply(first, null)
      stepwise.apply(null, second)
      expect(direct.balances).toEqual(stepwise.balances)
      expect(diffRollups(direct.rollups, stepwise.rollups)).toEqual([])
    }
  })

  it('the generator produces enough valid operations to be meaningful', () => {
    const r = rng(42)
    let valid = 0
    for (let i = 0; i < 200; i++) if (randomTx(r, `t${i}`)) valid++
    expect(valid).toBeGreaterThan(120)
  })
})
```

- [ ] **Step 3: Run**

Run: `npx vitest run --config vitest.config.ts tests/unit/domain/ledger/property.test.ts`
Expected: PASS. If an invariant fails, the bug is in the domain code of Task 3/4 (not in the test): fix the domain, keep the test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(ledger): property tests for balances and rollups

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


---

### Task 6: Server transaction writes (create / update / delete) with integration tests

**Model:** sonnet

**Files:**
- Create: `lib/server/ledger/deps.ts`, `paths.ts`, `lock.ts`, `audit.ts`, `write.ts`
- Create: `tests/integration/helpers.ts`, `tests/integration/ledger-transactions.test.ts`

All server ledger modules except `index.ts` (Task 9) import no `server-only` and take the Firestore instance through `LedgerDeps`, so the migration script and the integration tests can use them.

- [ ] **Step 1: Write `deps.ts`, `paths.ts`, `audit.ts`, `lock.ts`**

`lib/server/ledger/deps.ts`:

```ts
import type { Firestore } from 'firebase-admin/firestore'
import type { RateSnapshot } from '@/lib/server/fx/types'

export interface LedgerDeps {
  db: Firestore
  /** NBP table A rate snapshot (S04). */
  resolveRate: (from: string, to: string, date: string) => Promise<RateSnapshot>
  now: () => Date
  /** The Warsaw day, YYYY-MM-DD. */
  today: () => string
}
```

`lib/server/ledger/paths.ts`:

```ts
import type { Firestore } from 'firebase-admin/firestore'

export const orgRef = (db: Firestore, orgId: string) => db.collection('organizations').doc(orgId)
export const accountsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('accounts')
export const transactionsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('transactions')
export const categoriesCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('categories')
export const rollupsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('rollups')
export const auditCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('audit')
/** organizations/{org}/ledger/lock: closed to clients (firestore.rules). */
export const lockRef = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('ledger').doc('lock')
```

`lib/server/ledger/audit.ts`:

```ts
import { Timestamp } from 'firebase-admin/firestore'
import type { LedgerDeps } from './deps'

export type AuditAction =
  | 'tx.create' | 'tx.update' | 'tx.delete'
  | 'account.create' | 'account.update' | 'account.delete'
  | 'org.update' | 'ledger.rebuild' | 'migration.v2'

/** The audit entry to `create()` in the same transaction as the change it records. */
export function auditData(
  deps: LedgerDeps,
  action: AuditAction,
  uid: string,
  targetId: string,
  before: unknown,
  after: unknown,
): Record<string, unknown> {
  return { at: Timestamp.fromDate(deps.now()), uid, action, targetId, before: before ?? null, after: after ?? null }
}
```

`lib/server/ledger/lock.ts`:

```ts
import { Timestamp, type Transaction } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerDeps } from './deps'
import { lockRef } from './paths'

export const LOCK_MS = 5 * 60 * 1000

function active(until: unknown, now: Date): boolean {
  return until instanceof Timestamp && until.toMillis() > now.getTime()
}

/** Inside a write transaction: refuses while a rebuild holds the lock. Costs one read. */
export async function assertUnlocked(t: Transaction, deps: LedgerDeps, orgId: string): Promise<void> {
  const snap = await t.get(lockRef(deps.db, orgId))
  if (snap.exists && active(snap.get('until'), deps.now())) throw new LedgerError('ledger_busy')
}

/** Takes the lease for LOCK_MS or throws ledger_busy. */
export async function acquireLock(deps: LedgerDeps, orgId: string, holder: string): Promise<void> {
  const ref = lockRef(deps.db, orgId)
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (snap.exists && active(snap.get('until'), deps.now())) throw new LedgerError('ledger_busy')
    t.set(ref, { until: Timestamp.fromMillis(deps.now().getTime() + LOCK_MS), holder })
  })
}

export async function releaseLock(deps: LedgerDeps, orgId: string): Promise<void> {
  await lockRef(deps.db, orgId).delete()
}
```

- [ ] **Step 2: Write `write.ts`**

```ts
import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'
import { attachFx, buildTransaction, fxPlan } from '@/lib/domain/ledger/build'
import { changeSet } from '@/lib/domain/ledger/change'
import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { applyPatch, toRawInput, type TransactionInput, type TransactionPatch } from '@/lib/domain/ledger/input'
import { nest } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'
import type { RateSnapshot } from '@/lib/server/fx/types'
import { auditData, type AuditAction } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, categoriesCol, orgRef, rollupsCol, transactionsCol } from './paths'

export interface WriteResult {
  transaction: LedgerTransaction
  /** True when a create with an already used clientId returned the existing operation. */
  replayed: boolean
}

/** A fully built operation plus what the build assumed about the world (re-checked inside the transaction). */
interface Prepared {
  tx: LedgerTransaction
  baseCurrency: string
  /** accountId -> currency the build assumed. */
  currencies: Record<string, string>
}

interface Job {
  action: AuditAction
  txId: string
  prior: { tx: LedgerTransaction; version: Timestamp } | null
  next: Prepared | null
}

function evidenceOf(s: RateSnapshot): RateEvidence {
  // Only final snapshots may be stored for good (S04). The plan never asks for a date after today.
  if (!s.final) throw new Error('refusing to store a non-final rate snapshot')
  return { rate: s.rate, from: s.from, to: s.to, requestedDate: s.requestedDate, rateDate: s.rateDate, tableNo: s.tableNo, source: s.source }
}

async function loadAccount(deps: LedgerDeps, orgId: string, id: string) {
  const snap = await accountsCol(deps.db, orgId).doc(id).get()
  return snap.exists ? parseAccount(snap.id, snap.data()) : null
}

/** Reads what the input depends on, builds the operation and resolves its rates (network, so outside the transaction). */
async function prepare(deps: LedgerDeps, orgId: string, txId: string, input: TransactionInput): Promise<Prepared> {
  const org = await orgRef(deps.db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')
  const baseCurrency = org.get('currency') as string

  const account = await loadAccount(deps, orgId, input.accountId)
  if (!account) throw new LedgerError('account_not_found', 'accountId')
  const toAccount = input.toAccountId === undefined ? undefined : await loadAccount(deps, orgId, input.toAccountId)
  if (input.toAccountId !== undefined && !toAccount) throw new LedgerError('account_not_found', 'toAccountId')

  let category: { type: 'income' | 'expense' } | null = null
  if (input.categoryId !== undefined) {
    const snap = await categoriesCol(deps.db, orgId).doc(input.categoryId).get()
    const type = snap.get('type')
    if (snap.exists && (type === 'income' || type === 'expense')) category = { type }
  }

  const today = deps.today()
  const built = buildTransaction(txId, input, { today, account, toAccount: toAccount ?? undefined, category, baseCurrency })
  const plan = fxPlan(built, baseCurrency, today)
  const snapshots = await Promise.all(plan.map((r) => deps.resolveRate(r.from, r.to, r.date)))
  const tx = attachFx(built, plan, snapshots.map(evidenceOf))

  const currencies: Record<string, string> = { [account.id]: account.currency }
  if (toAccount) currencies[toAccount.id] = toAccount.currency
  return { tx, baseCurrency, currencies }
}

function accountIdsOf(tx: LedgerTransaction): string[] {
  return tx.toAccountId === undefined ? [tx.accountId] : [tx.accountId, tx.toAccountId]
}

/** One Firestore transaction: operation + balances + rollup increments + audit. All reads come first. */
async function commit(deps: LedgerDeps, orgId: string, uid: string, job: Job): Promise<WriteResult> {
  const { db } = deps
  const txRef = transactionsCol(db, orgId).doc(job.txId)

  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const currentSnap = await t.get(txRef)

    const involved = new Set<string>([
      ...(job.prior ? accountIdsOf(job.prior.tx) : []),
      ...(job.next ? accountIdsOf(job.next.tx) : []),
    ])
    const accountSnaps = new Map<string, DocumentSnapshot>()
    for (const id of involved) accountSnaps.set(id, await t.get(accountsCol(db, orgId).doc(id)))
    const categoryId = job.next?.tx.categoryId
    const categorySnap = categoryId === undefined ? null : await t.get(categoriesCol(db, orgId).doc(categoryId))

    // ---- checks (nothing is written yet) ----
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const baseCurrency = orgSnap.get('currency') as string
    if (job.next && job.next.baseCurrency !== baseCurrency) throw new LedgerError('conflict')

    if (job.prior === null) {
      if (currentSnap.exists) {
        const existing = parseTransaction(currentSnap.id, currentSnap.data())
        if (!existing) throw new LedgerError('conflict')
        return { transaction: existing, replayed: true }
      }
    } else {
      if (!currentSnap.exists) throw new LedgerError('not_found')
      if (!currentSnap.updateTime || !currentSnap.updateTime.isEqual(job.prior.version)) throw new LedgerError('conflict')
    }

    for (const [id, snap] of accountSnaps) {
      const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
      if (!account) throw new LedgerError('conflict')
      const assumed = job.next?.currencies[id]
      if (assumed !== undefined && assumed !== account.currency) throw new LedgerError('conflict')
    }
    if (categorySnap !== null && job.next) {
      if (!categorySnap.exists || categorySnap.get('type') !== job.next.tx.type) throw new LedgerError('category_not_found', 'categoryId')
    }

    // ---- writes ----
    const ts = Timestamp.fromDate(deps.now())
    const change = changeSet(job.prior?.tx ?? null, job.next?.tx ?? null, baseCurrency)

    for (const [id, delta] of Object.entries(change.balanceDeltas)) {
      t.update(accountsCol(db, orgId).doc(id), { balanceMinor: FieldValue.increment(delta), updatedAt: ts })
    }
    for (const [id, flat] of change.rollupDeltas) {
      t.set(rollupsCol(db, orgId).doc(id), nest(flat, (n) => FieldValue.increment(n)), { merge: true })
    }

    if (job.next) {
      const old = currentSnap.data() ?? {}
      t.set(txRef, {
        ...transactionToDoc(job.next.tx),
        orgId,
        createdAt: job.prior ? (old.createdAt ?? ts) : ts,
        createdBy: job.prior ? (old.createdBy ?? uid) : uid,
        updatedAt: ts,
        updatedBy: uid,
      })
    } else {
      t.delete(txRef)
    }

    t.create(
      auditCol(db, orgId).doc(),
      auditData(
        deps,
        job.action,
        uid,
        job.txId,
        job.prior ? transactionToDoc(job.prior.tx) : null,
        job.next ? transactionToDoc(job.next.tx) : null,
      ),
    )

    return { transaction: (job.next ?? job.prior)!.tx, replayed: false }
  })
}

export async function createTransaction(deps: LedgerDeps, orgId: string, uid: string, input: TransactionInput): Promise<WriteResult> {
  const txId = input.clientId ?? transactionsCol(deps.db, orgId).doc().id
  const next = await prepare(deps, orgId, txId, input)
  return commit(deps, orgId, uid, { action: 'tx.create', txId, prior: null, next })
}

async function loadPrior(deps: LedgerDeps, orgId: string, txId: string) {
  const snap = await transactionsCol(deps.db, orgId).doc(txId).get()
  if (!snap.exists) throw new LedgerError('not_found')
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx || !snap.updateTime) throw new LedgerError('conflict')
  return { tx, version: snap.updateTime }
}

export async function updateTransaction(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  txId: string,
  patch: TransactionPatch,
): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  const next = await prepare(deps, orgId, txId, applyPatch(toRawInput(prior.tx), patch))
  return commit(deps, orgId, uid, { action: 'tx.update', txId, prior, next })
}

export async function deleteTransaction(deps: LedgerDeps, orgId: string, uid: string, txId: string): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  return commit(deps, orgId, uid, { action: 'tx.delete', txId, prior, next: null })
}
```

If TypeScript complains about the non-null assertion on `(job.next ?? job.prior)!`, restructure to return `job.next ? job.next.tx : (job.prior as NonNullable<typeof job.prior>).tx`.

- [ ] **Step 3: Write the integration helpers**

`tests/integration/helpers.ts`:

```ts
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { addDays } from '@/lib/domain/ledger/days'
import { accountToDoc } from '@/lib/domain/ledger/doc'
import { flatten } from '@/lib/domain/ledger/rollups'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import type { RateSnapshot } from '@/lib/server/fx/types'

export const PROJECT = 'demo-finflow'
export const TODAY = '2026-10-27'
export const UID = 'user-alice'
export const ORG = 'org1'

export function testDb(): Firestore {
  const app = getApps().find((a) => a.name === 'ledger-it') ?? initializeApp({ projectId: PROJECT }, 'ledger-it')
  return getFirestore(app)
}

export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set (run through npm run test:integration)')
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`could not clear the emulator: ${res.status}`)
}

const MID: Record<string, number> = { PLN: 1, EUR: 4.4, USD: 3.9, UAH: 0.1 }

/** A deterministic stand-in for resolveRate: cross rates through PLN, rateDate = the day before. */
export function fakeResolveRate(calls?: string[]): LedgerDeps['resolveRate'] {
  return async (from, to, date): Promise<RateSnapshot> => {
    calls?.push(`${from}>${to}@${date}`)
    const rate = from === to ? 1 : Math.round((MID[from] / MID[to]) * 1e8) / 1e8
    return {
      rate, from, to, requestedDate: date, rateDate: from === to ? date : addDays(date, -1),
      tableNo: from === to ? null : `T/${date}`, source: from === to ? 'identity' : 'NBP_A', final: date <= TODAY,
    }
  }
}

export function makeDeps(db: Firestore, over: Partial<LedgerDeps> = {}): LedgerDeps {
  return { db, resolveRate: fakeResolveRate(), now: () => new Date('2026-10-27T10:00:00Z'), today: () => TODAY, ...over }
}

export async function seedOrg(db: Firestore, orgId = ORG, currency = 'PLN'): Promise<void> {
  await db.doc(`organizations/${orgId}`).set({ name: 'Acme', currency, ownerId: UID, plan: 'trial' })
}

export async function seedCategory(db: Firestore, orgId: string, id: string, type: 'income' | 'expense'): Promise<void> {
  await db.doc(`organizations/${orgId}/categories/${id}`).set({ orgId, name: id, type, color: '#000000' })
}

export async function seedAccount(db: Firestore, orgId: string, id: string, currency: string, openingMinor = 0): Promise<void> {
  const doc = accountToDoc({ id, name: id, type: 'bank', currency, color: '#00c896', openingMinor, balanceMinor: openingMinor })
  await db.doc(`organizations/${orgId}/accounts/${id}`).set({ ...doc, orgId })
}

export async function readDoc(db: Firestore, path: string): Promise<Record<string, unknown> | undefined> {
  return (await db.doc(path).get()).data()
}

/** The non-zero fields of a rollup document as flat dotted fields ({} when the document is absent or all zero). */
export async function rollup(db: Firestore, orgId: string, id: string): Promise<Record<string, number>> {
  const flat = flatten((await readDoc(db, `organizations/${orgId}/rollups/${id}`)) ?? {})
  return Object.fromEntries(Object.entries(flat).filter(([, v]) => v !== 0))
}

export async function balanceOf(db: Firestore, orgId: string, accountId: string): Promise<number> {
  return (await readDoc(db, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as number
}

export async function auditActions(db: Firestore, orgId: string): Promise<string[]> {
  const snap = await db.collection(`organizations/${orgId}/audit`).get()
  return snap.docs.map((d) => d.get('action') as string).sort()
}
```

- [ ] **Step 4: Write the failing integration tests**

`tests/integration/ledger-transactions.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { acquireLock, releaseLock } from '@/lib/server/ledger/lock'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import {
  ORG, UID, auditActions, balanceOf, clearFirestore, fakeResolveRate, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, testDb,
} from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

const input = (over: Record<string, unknown>) =>
  parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 12345, paymentDate: '2026-10-20', ...over })
const patch = (over: Record<string, unknown>) => parseTransactionPatch(over)
const pl = (month: string) => rollup(db, ORG, `pl_${month}`)

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'pln1', 'PLN', 1000)
  await seedAccount(db, ORG, 'pln2', 'PLN', 0)
  await seedAccount(db, ORG, 'eur1', 'EUR', 0)
  await seedCategory(db, ORG, 'inc', 'income')
  await seedCategory(db, ORG, 'exp', 'expense')
})

describe('createTransaction', () => {
  it('writes the operation, the balance, the rollups and the audit entry together', async () => {
    const { transaction, replayed } = await createTransaction(deps, ORG, UID, input({ categoryId: 'inc' }))
    expect(replayed).toBe(false)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)

    const doc = await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)
    expect(doc).toMatchObject({ schemaVersion: 2, type: 'income', amountMinor: 12345, currency: 'PLN', paymentDate: '2026-10-20', orgId: ORG, createdBy: UID })

    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({ inMinor: 12345, inBase: 12345 })
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({ 'categories.inc.incomeBase': 12345 })
    expect(await pl('2026-10')).toEqual({ 'categories.inc.incomeBase': 12345 })
    expect(await auditActions(db, ORG)).toEqual(['tx.create'])
  })

  it('a repeated clientId returns the existing operation and changes nothing', async () => {
    const body = input({ clientId: 'client-aaaa1111' })
    const first = await createTransaction(deps, ORG, UID, body)
    const again = await createTransaction(deps, ORG, UID, body)
    expect(again.replayed).toBe(true)
    expect(again.transaction.id).toBe(first.transaction.id)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
    expect(await auditActions(db, ORG)).toEqual(['tx.create'])
  })

  it('spreads a period over the months in pl but keeps cash on the payment day', async () => {
    await createTransaction(deps, ORG, UID, input({
      type: 'expense', categoryId: 'exp', amountMinor: 1000, paymentDate: '2026-03-02',
      accrual: { mode: 'period', from: '2026-01-15', to: '2026-03-02' },
    }))
    expect(await pl('2026-01')).toEqual({ 'categories.exp.expenseBase': 361 })
    expect(await pl('2026-02')).toEqual({ 'categories.exp.expenseBase': 595 })
    expect(await pl('2026-03')).toEqual({ 'categories.exp.expenseBase': 44 })
    expect(await rollup(db, ORG, 'cash_pln1_2026-03-02')).toEqual({ outMinor: 1000, outBase: 1000 })
  })

  it('stores fx evidence and base amounts for another currency, asking one rate per distinct date', async () => {
    const calls: string[] = []
    const d = makeDeps(db, { resolveRate: fakeResolveRate(calls) })
    const same = await createTransaction(d, ORG, UID, input({ accountId: 'eur1', type: 'expense', amountMinor: 1000 }))
    expect(calls).toEqual(['EUR>PLN@2026-10-20'])
    expect(same.transaction.base).toEqual({ payment: 4400, accrual: 4400 })
    expect(same.transaction.fx?.payment?.tableNo).toBe('T/2026-10-20')

    calls.length = 0
    const split = await createTransaction(d, ORG, UID, input({ accountId: 'eur1', type: 'expense', amountMinor: 1000, accrual: { mode: 'date', date: '2026-10-10' } }))
    expect(calls).toEqual(['EUR>PLN@2026-10-20', 'EUR>PLN@2026-10-10'])
    expect(split.transaction.base).toEqual({ payment: 4400, accrual: 4400 })
    expect(await rollup(db, ORG, 'cash_eur1_2026-10-20')).toMatchObject({ outMinor: 2000, outBase: 8800 })
  })

  it('a cross-currency transfer moves both amounts', async () => {
    await createTransaction(deps, ORG, UID, input({ type: 'transfer', accountId: 'pln1', toAccountId: 'eur1', amountMinor: 440, toAmountMinor: 100 }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(560)
    expect(await balanceOf(db, ORG, 'eur1')).toBe(100)
    expect(await rollup(db, ORG, 'cash_eur1_2026-10-20')).toEqual({ transferInMinor: 100 })
    expect(await pl('2026-10')).toEqual({})
  })

  it('a planned operation changes nothing but is stored; patching it to actual applies it', async () => {
    const planned = await createTransaction(deps, ORG, UID, input({ status: 'planned', paymentDate: '2026-11-15' }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await rollup(db, ORG, 'cash_pln1_2026-11-15')).toEqual({})

    await updateTransaction(deps, ORG, UID, planned.transaction.id, patch({ status: 'actual', paymentDate: '2026-10-27' }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-27')).toEqual({ inMinor: 12345, inBase: 12345 })
  })

  it.each([
    ['an actual operation after today', { paymentDate: '2026-10-28' }, 'future_actual:paymentDate'],
    ['an unknown account', { accountId: 'ghost' }, 'account_not_found:accountId'],
    ['an unknown category', { categoryId: 'ghost' }, 'category_not_found:categoryId'],
    ['a category of the other type', { categoryId: 'exp' }, 'category_not_found:categoryId'],
  ])('refuses %s', async (_l, over, expected) => {
    expect(await code(createTransaction(deps, ORG, UID, input(over)))).toBe(expected)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await auditActions(db, ORG)).toEqual([])
  })

  it('answers ledger_busy while the ledger is locked and works again after the lock is released', async () => {
    await acquireLock(deps, ORG, 'test')
    expect(await code(createTransaction(deps, ORG, UID, input({})))).toBe('ledger_busy:undefined')
    await releaseLock(deps, ORG)
    await createTransaction(deps, ORG, UID, input({}))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
  })

  it('an expired lock does not block', async () => {
    await acquireLock(deps, ORG, 'test')
    const later = makeDeps(db, { now: () => new Date('2026-10-27T10:06:00Z') })
    await createTransaction(later, ORG, UID, input({}))
  })
})

describe('updateTransaction', () => {
  it('the screenshot case: editing the amount moves the balance by the difference', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ amountMinor: 123450 }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(124450)
    await updateTransaction(deps, ORG, UID, transaction.id, patch({ amountMinor: 123460 }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(124460)
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({ inMinor: 123460, inBase: 123460 })
  })

  it('moving an operation to another account, type and date rebalances both accounts and the rollups', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ type: 'income', categoryId: 'inc' }))
    await updateTransaction(deps, ORG, UID, transaction.id, patch({
      type: 'expense', accountId: 'pln2', categoryId: 'exp', paymentDate: '2026-09-05',
    }))
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await balanceOf(db, ORG, 'pln2')).toBe(-12345)
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({})
    expect(await pl('2026-09')).toEqual({ 'categories.exp.expenseBase': 12345 })
    expect(await pl('2026-10')).toEqual({})
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.update'])
  })

  it('clearing a field with null and following the payment date for the accrual', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ categoryId: 'inc', description: 'x' }))
    const out = await updateTransaction(deps, ORG, UID, transaction.id, patch({ categoryId: null, description: null, paymentDate: '2026-10-21' }))
    expect(out.transaction.categoryId).toBeUndefined()
    expect(out.transaction.accrual).toEqual({ mode: 'date', date: '2026-10-21' })
    const doc = await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)
    expect(doc).not.toHaveProperty('categoryId')
    expect(doc).toMatchObject({ createdBy: UID, updatedBy: UID })
  })

  it('an unknown or deleted operation is not_found', async () => {
    expect(await code(updateTransaction(deps, ORG, UID, 'nope', patch({ amountMinor: 5 })))).toBe('not_found:undefined')
  })

  it('an invalid merged result is refused and nothing changes', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({}))
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, patch({ type: 'transfer' })))).toBe('invalid_input:toAccountId')
    expect(await balanceOf(db, ORG, 'pln1')).toBe(13345)
  })
})

describe('deleteTransaction', () => {
  it('reverses the balance and the rollups and keeps an audit trail', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, input({ categoryId: 'inc' }))
    await deleteTransaction(deps, ORG, UID, transaction.id)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)).toBeUndefined()
    expect(await rollup(db, ORG, 'cash_pln1_2026-10-20')).toEqual({})
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.delete'])
    expect(await code(deleteTransaction(deps, ORG, UID, transaction.id))).toBe('not_found:undefined')
  })
})
```

- [ ] **Step 5: Run the integration suite**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:integration`
Expected: all PASS. Fix `write.ts` (not the tests) for real failures; the one allowed test adjustment is the zero-field style above.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: no new errors.

```bash
git add -A
git commit -m "feat(ledger): atomic server writes for operations with integration tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Server account and company writes

**Model:** sonnet

**Files:**
- Create: `lib/server/ledger/accounts.ts`, `lib/server/ledger/org.ts`
- Create: `tests/integration/ledger-accounts.test.ts`

- [ ] **Step 1: Write `accounts.ts`**

```ts
import { Timestamp, type Transaction } from 'firebase-admin/firestore'
import { accountToDoc, parseAccount } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { AccountInput, AccountPatch } from '@/lib/domain/ledger/entity-input'
import type { LedgerAccount } from '@/lib/domain/ledger/types'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, orgRef, transactionsCol } from './paths'

/** True when any operation (any status) uses the account as source or target. */
async function hasOperations(t: Transaction, deps: LedgerDeps, orgId: string, accountId: string): Promise<boolean> {
  const col = transactionsCol(deps.db, orgId)
  const asSource = await t.get(col.where('accountId', '==', accountId).limit(1))
  const asTarget = await t.get(col.where('toAccountId', '==', accountId).limit(1))
  return !asSource.empty || !asTarget.empty
}

export async function createAccount(deps: LedgerDeps, orgId: string, uid: string, input: AccountInput): Promise<LedgerAccount> {
  const ref = accountsCol(deps.db, orgId).doc()
  const account: LedgerAccount = { id: ref.id, ...input, balanceMinor: input.openingMinor }
  await deps.db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    if (!(await t.get(orgRef(deps.db, orgId))).exists) throw new LedgerError('not_found', 'org')
    const ts = Timestamp.fromDate(deps.now())
    t.create(ref, { ...accountToDoc(account), orgId, createdAt: ts, updatedAt: ts })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'account.create', uid, ref.id, null, accountToDoc(account)))
  })
  return account
}

export async function updateAccount(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  accountId: string,
  patch: AccountPatch,
): Promise<LedgerAccount> {
  const ref = accountsCol(deps.db, orgId).doc(accountId)
  return deps.db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const before = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!before) throw new LedgerError('not_found')

    if (patch.currency !== undefined && patch.currency !== before.currency && (await hasOperations(t, deps, orgId, accountId))) {
      throw new LedgerError('account_has_operations', 'currency')
    }

    const after: LedgerAccount = { ...before, ...patch }
    // balance = opening + sum of effects: moving the opening balance moves the balance by the same amount.
    after.balanceMinor = before.balanceMinor + (after.openingMinor - before.openingMinor)

    t.update(ref, { ...accountToDoc(after), updatedAt: Timestamp.fromDate(deps.now()) })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'account.update', uid, accountId, accountToDoc(before), accountToDoc(after)))
    return after
  })
}

export async function deleteAccount(deps: LedgerDeps, orgId: string, uid: string, accountId: string): Promise<void> {
  const ref = accountsCol(deps.db, orgId).doc(accountId)
  await deps.db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const before = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!before) throw new LedgerError('not_found')
    if (await hasOperations(t, deps, orgId, accountId)) throw new LedgerError('account_has_operations')
    t.delete(ref)
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'account.delete', uid, accountId, accountToDoc(before), null))
  })
}
```

- [ ] **Step 2: Write `org.ts`**

```ts
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { OrgPatch } from '@/lib/domain/ledger/entity-input'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { auditCol, orgRef, transactionsCol } from './paths'

/**
 * Name and currency of the company. The currency defines every stored base amount, so it cannot
 * change once the company has any operation (409 currency_locked).
 */
export async function updateOrganization(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  patch: OrgPatch,
): Promise<{ name: string; currency: string }> {
  const ref = orgRef(deps.db, orgId)
  return deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new LedgerError('not_found')
    const before = { name: snap.get('name') as string, currency: snap.get('currency') as string }
    const after = { name: patch.name ?? before.name, currency: patch.currency ?? before.currency }

    if (after.currency !== before.currency) {
      const any = await t.get(transactionsCol(deps.db, orgId).limit(1))
      if (!any.empty) throw new LedgerError('currency_locked', 'currency')
    }

    t.update(ref, after)
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'org.update', uid, orgId, before, after))
    return after
  })
}
```

- [ ] **Step 3: Write the integration tests**

`tests/integration/ledger-accounts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseAccountInput, parseAccountPatch, parseOrgPatch } from '@/lib/domain/ledger/entity-input'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { createAccount, deleteAccount, updateAccount } from '@/lib/server/ledger/accounts'
import { acquireLock } from '@/lib/server/ledger/lock'
import { updateOrganization } from '@/lib/server/ledger/org'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

const ACC = { name: 'Main', type: 'bank', currency: 'PLN', color: '#00c896', openingMinor: 5000 }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
})

describe('accounts', () => {
  it('create sets balance = opening and audits', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    expect(acc.balanceMinor).toBe(5000)
    expect(await readDoc(db, `organizations/${ORG}/accounts/${acc.id}`)).toMatchObject({ schemaVersion: 2, openingMinor: 5000, balanceMinor: 5000, orgId: ORG })
    expect(await auditActions(db, ORG)).toEqual(['account.create'])
  })

  it('editing the opening balance moves the balance by the difference', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: acc.id, amountMinor: 700, paymentDate: '2026-10-20' }))
    const out = await updateAccount(deps, ORG, UID, acc.id, parseAccountPatch({ openingMinor: 6000, name: 'Renamed' }))
    expect(out).toMatchObject({ name: 'Renamed', openingMinor: 6000, balanceMinor: 6700 })
    expect(await balanceOf(db, ORG, acc.id)).toBe(6700)
  })

  it('the currency can change only while the account has no operations; any status counts', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    expect((await updateAccount(deps, ORG, UID, acc.id, parseAccountPatch({ currency: 'EUR' }))).currency).toBe('EUR')
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', status: 'planned', accountId: acc.id, amountMinor: 1, paymentDate: '2026-11-20' }))
    expect(await code(updateAccount(deps, ORG, UID, acc.id, parseAccountPatch({ currency: 'PLN' })))).toBe('account_has_operations:currency')
  })

  it('an account with operations (as source or as target) cannot be deleted; an empty one can', async () => {
    const a = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    const b = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    const empty = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'transfer', accountId: a.id, toAccountId: b.id, amountMinor: 100, paymentDate: '2026-10-20' }))
    expect(await code(deleteAccount(deps, ORG, UID, a.id))).toBe('account_has_operations:undefined')
    expect(await code(deleteAccount(deps, ORG, UID, b.id))).toBe('account_has_operations:undefined')
    await deleteAccount(deps, ORG, UID, empty.id)
    expect(await readDoc(db, `organizations/${ORG}/accounts/${empty.id}`)).toBeUndefined()
    expect(await auditActions(db, ORG)).toContain('account.delete')
  })

  it('writes are refused while the ledger is locked', async () => {
    await acquireLock(deps, ORG, 'test')
    expect(await code(createAccount(deps, ORG, UID, parseAccountInput(ACC)))).toBe('ledger_busy:undefined')
  })

  it('an unknown account is not_found', async () => {
    expect(await code(updateAccount(deps, ORG, UID, 'nope', parseAccountPatch({ name: 'x' })))).toBe('not_found:undefined')
    expect(await code(deleteAccount(deps, ORG, UID, 'nope'))).toBe('not_found:undefined')
  })
})

describe('updateOrganization', () => {
  it('renames and changes the currency of an empty company', async () => {
    expect(await updateOrganization(deps, ORG, UID, parseOrgPatch({ name: 'New', currency: 'EUR' }))).toEqual({ name: 'New', currency: 'EUR' })
    expect(await readDoc(db, `organizations/${ORG}`)).toMatchObject({ name: 'New', currency: 'EUR', ownerId: UID })
    expect(await auditActions(db, ORG)).toEqual(['org.update'])
  })

  it('freezes the currency once there is an operation, but still allows a rename', async () => {
    const acc = await createAccount(deps, ORG, UID, parseAccountInput(ACC))
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: acc.id, amountMinor: 1, paymentDate: '2026-10-20' }))
    expect(await code(updateOrganization(deps, ORG, UID, parseOrgPatch({ currency: 'EUR' })))).toBe('currency_locked:currency')
    expect((await updateOrganization(deps, ORG, UID, parseOrgPatch({ name: 'Renamed' }))).name).toBe('Renamed')
    expect(await updateOrganization(deps, ORG, UID, parseOrgPatch({ currency: 'PLN' }))).toMatchObject({ currency: 'PLN' })
  })
})
```

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:integration && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add -A
git commit -m "feat(ledger): server account and company writes with the currency lock

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: verifyLedger and rebuildLedger

**Model:** sonnet

**Files:**
- Create: `lib/server/ledger/verify.ts`, `lib/server/ledger/rebuild.ts`
- Create: `tests/integration/ledger-verify.test.ts`
- Modify: `lib/domain/ledger/input.ts` (add `fullPatch`), `tests/unit/domain/ledger/model.ts` (categories per type)

- [ ] **Step 1: Add `fullPatch` to the domain**

Append to `lib/domain/ledger/input.ts`:

```ts
/** A patch that replaces every editable field: optional fields absent from `raw` become null (cleared). */
export function fullPatch(raw: RawInput): TransactionPatch {
  const patch: TransactionPatch = { ...raw }
  for (const key of NULLABLE) if (!(key in patch)) patch[key] = null
  return patch
}
```

Add a test to `tests/unit/domain/ledger/input.test.ts`:

```ts
import { fullPatch } from '@/lib/domain/ledger/input'

it('fullPatch nulls the absent optional fields and passes parseTransactionPatch', () => {
  const patch = fullPatch({ type: 'income', status: 'actual', accountId: 'a', amountMinor: 5, paymentDate: '2026-10-20', isRecurring: false, tags: [], fileUrls: [] })
  expect(patch).toMatchObject({ categoryId: null, accrual: null, description: null, toAccountId: null })
  expect(() => parseTransactionPatch(patch)).not.toThrow()
})
```

(Place the import with the other imports at the top of the test file.)

In `tests/unit/domain/ledger/model.ts` change the category draw to depend on the type, so categories can be seeded with a fixed type per id: replace `if (r() < 0.7) input.categoryId = pick(r, ['c1', 'c2', 'c3'])` with

```ts
    if (r() < 0.7) input.categoryId = pick(r, type === 'income' ? ['ci1', 'ci2'] : ['ce1', 'ce2'])
```

- [ ] **Step 2: Write `verify.ts`**

```ts
import { flatten, diffRollups, type RollupDiff, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { computeLedger, type ExpectedLedger } from '@/lib/domain/ledger/expected'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { LedgerDeps } from './deps'
import { accountsCol, orgRef, rollupsCol, transactionsCol } from './paths'

export const REPORT_LIMIT = 50

export interface LedgerReport {
  ok: boolean
  accounts: number
  transactions: number
  /** Operations that exist but cannot be counted (not schema 2, missing account or base amounts). */
  uncountable: string[]
  /** Accounts that are not schema 2 documents. */
  unreadableAccounts: string[]
  balanceDiffs: Array<{ accountId: string; stored: number; expected: number }>
  rollupDiffs: RollupDiff[]
  /** True when a list above was cut at REPORT_LIMIT entries. */
  truncated: boolean
}

export interface LoadedLedger {
  baseCurrency: string
  accounts: LedgerAccount[]
  unreadableAccounts: string[]
  txs: LedgerTransaction[]
  unreadableTransactions: string[]
  storedRollups: RollupDocs
}

export async function loadLedger(deps: LedgerDeps, orgId: string): Promise<LoadedLedger> {
  const org = await orgRef(deps.db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')

  const accounts: LedgerAccount[] = []
  const unreadableAccounts: string[] = []
  for (const doc of (await accountsCol(deps.db, orgId).get()).docs) {
    const account = parseAccount(doc.id, doc.data())
    if (account) accounts.push(account)
    else unreadableAccounts.push(doc.id)
  }

  const txs: LedgerTransaction[] = []
  const unreadableTransactions: string[] = []
  for (const doc of (await transactionsCol(deps.db, orgId).get()).docs) {
    const tx = parseTransaction(doc.id, doc.data())
    if (tx) txs.push(tx)
    else unreadableTransactions.push(doc.id)
  }

  const storedRollups: RollupDocs = new Map()
  for (const doc of (await rollupsCol(deps.db, orgId).get()).docs) storedRollups.set(doc.id, flatten(doc.data()))

  return { baseCurrency: org.get('currency') as string, accounts, unreadableAccounts, txs, unreadableTransactions, storedRollups }
}

export function buildReport(data: LoadedLedger, expected: ExpectedLedger): LedgerReport {
  const balanceDiffs = data.accounts
    .filter((a) => a.balanceMinor !== expected.balances[a.id])
    .map((a) => ({ accountId: a.id, stored: a.balanceMinor, expected: expected.balances[a.id] }))
  const rollupDiffs = diffRollups(data.storedRollups, expected.rollups)
  const uncountable = [...data.unreadableTransactions, ...expected.invalid]
  const truncated = balanceDiffs.length > REPORT_LIMIT || rollupDiffs.length > REPORT_LIMIT || uncountable.length > REPORT_LIMIT
  return {
    ok: balanceDiffs.length === 0 && rollupDiffs.length === 0 && uncountable.length === 0 && data.unreadableAccounts.length === 0,
    accounts: data.accounts.length,
    transactions: data.txs.length + data.unreadableTransactions.length,
    uncountable: uncountable.slice(0, REPORT_LIMIT),
    unreadableAccounts: data.unreadableAccounts.slice(0, REPORT_LIMIT),
    balanceDiffs: balanceDiffs.slice(0, REPORT_LIMIT),
    rollupDiffs: rollupDiffs.slice(0, REPORT_LIMIT),
    truncated,
  }
}

/** Read-only: compares stored balances and rollups with what the operations imply. */
export async function verifyLedger(deps: LedgerDeps, orgId: string): Promise<LedgerReport> {
  const data = await loadLedger(deps, orgId)
  return buildReport(data, computeLedger(data.accounts, data.txs, data.baseCurrency))
}
```

- [ ] **Step 3: Write `rebuild.ts`**

```ts
import { Timestamp, type WriteBatch } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { nest } from '@/lib/domain/ledger/rollups'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { acquireLock, releaseLock } from './lock'
import { accountsCol, auditCol, rollupsCol } from './paths'
import { buildReport, loadLedger, verifyLedger, type LedgerReport } from './verify'

const BATCH_SIZE = 400

export interface RebuildResult extends LedgerReport {
  applied: boolean
}

/**
 * Dry run (`apply: false`) = verifyLedger. With `apply: true`: takes the ledger lock (writes answer
 * ledger_busy meanwhile), recomputes balances and rollups from the operations, overwrites what differs,
 * deletes stale rollup documents and writes an audit entry. The returned report describes what was found.
 */
export async function rebuildLedger(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  opts: { apply: boolean },
): Promise<RebuildResult> {
  if (!opts.apply) return { ...(await verifyLedger(deps, orgId)), applied: false }

  await acquireLock(deps, orgId, uid)
  try {
    const data = await loadLedger(deps, orgId)
    const expected = computeLedger(data.accounts, data.txs, data.baseCurrency)
    const report = buildReport(data, expected)
    const ts = Timestamp.fromDate(deps.now())

    const ops: Array<(batch: WriteBatch) => void> = []
    for (const account of data.accounts) {
      if (account.balanceMinor !== expected.balances[account.id]) {
        ops.push((b) => b.update(accountsCol(deps.db, orgId).doc(account.id), { balanceMinor: expected.balances[account.id], updatedAt: ts }))
      }
    }
    for (const id of data.storedRollups.keys()) {
      if (!expected.rollups.has(id)) ops.push((b) => b.delete(rollupsCol(deps.db, orgId).doc(id)))
    }
    for (const [id, flat] of expected.rollups) {
      ops.push((b) => b.set(rollupsCol(deps.db, orgId).doc(id), nest(flat)))
    }
    ops.push((b) =>
      b.create(
        auditCol(deps.db, orgId).doc(),
        auditData(deps, 'ledger.rebuild', uid, orgId, null, {
          balanceDiffs: report.balanceDiffs.length,
          rollupDiffs: report.rollupDiffs.length,
          uncountable: report.uncountable.length,
        }),
      ),
    )

    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const batch = deps.db.batch()
      for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch)
      await batch.commit()
    }
    return { ...report, applied: true }
  } finally {
    await releaseLock(deps, orgId)
  }
}

export { LedgerError }
```

Remove the trailing `export { LedgerError }` and the unused import if lint flags them (they are not needed).

- [ ] **Step 4: Write the integration tests**

`tests/integration/ledger-verify.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { fullPatch, parseTransactionInput, parseTransactionPatch, toRawInput } from '@/lib/domain/ledger/input'
import { acquireLock } from '@/lib/server/ledger/lock'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ACCOUNTS, randomTx, rng } from '@/tests/unit/domain/ledger/model'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? e.code : `other:${String(e)}`
  }
  return 'none'
}

async function seedWorld(): Promise<void> {
  await clearFirestore()
  await seedOrg(db)
  for (const a of ACCOUNTS) await seedAccount(db, ORG, a.id, a.currency, a.openingMinor)
  for (const id of ['ci1', 'ci2']) await seedCategory(db, ORG, id, 'income')
  for (const id of ['ce1', 'ce2']) await seedCategory(db, ORG, id, 'expense')
}

beforeEach(seedWorld)

describe('verifyLedger', () => {
  it('an empty ledger is ok', async () => {
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true, accounts: 3, transactions: 0, balanceDiffs: [], rollupDiffs: [] })
  })

  it('random create / update / delete through the server keeps balances and rollups equal to the recomputation', async () => {
    for (let seed = 1; seed <= 6; seed++) {
      await seedWorld()
      const r = rng(seed)
      const live = new Map<string, true>()
      for (let step = 0; step < 25; step++) {
        const ids = [...live.keys()]
        const roll = r()
        try {
          if (roll < 0.6 || ids.length === 0) {
            const tx = randomTx(r, 'gen')
            if (!tx) continue
            const { transaction } = await createTransaction(deps, ORG, UID, parseTransactionInput(toRawInput(tx)))
            live.set(transaction.id, true)
          } else if (roll < 0.85) {
            const id = ids[Math.floor(r() * ids.length)]
            const tx = randomTx(r, id)
            if (tx) await updateTransaction(deps, ORG, UID, id, parseTransactionPatch(fullPatch(toRawInput(tx))))
          } else {
            const id = ids[Math.floor(r() * ids.length)]
            await deleteTransaction(deps, ORG, UID, id)
            live.delete(id)
          }
        } catch (e) {
          // A refusal (a LedgerError) must change nothing; verifyLedger below proves it. Anything else is a bug.
          if (!(e instanceof LedgerError)) throw e
        }
      }
      const report = await verifyLedger(deps, ORG)
      expect(report, `seed ${seed}`).toMatchObject({ ok: true, balanceDiffs: [], rollupDiffs: [], uncountable: [] })
    }
  })

  it('reports a drifted balance and a drifted rollup', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 1000, paymentDate: '2026-10-20' }))
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 123 })
    await db.doc(`organizations/${ORG}/rollups/cash_pln1_2026-10-20`).update({ inMinor: 5 })
    const report = await verifyLedger(deps, ORG)
    expect(report.ok).toBe(false)
    expect(report.balanceDiffs).toEqual([{ accountId: 'pln1', stored: 123, expected: 101000 }])
    expect(report.rollupDiffs).toEqual([{ docId: 'cash_pln1_2026-10-20', field: 'inMinor', stored: 5, expected: 1000 }])
  })

  it('reports an operation it cannot read', async () => {
    await db.doc(`organizations/${ORG}/transactions/legacy`).set({ type: 'income', accountId: 'pln1', amount: 5, date: new Date() })
    const report = await verifyLedger(deps, ORG)
    expect(report.ok).toBe(false)
    expect(report.uncountable).toEqual(['legacy'])
  })
})

describe('rebuildLedger', () => {
  it('a dry run writes nothing', async () => {
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 123 })
    const out = await rebuildLedger(deps, ORG, UID, { apply: false })
    expect(out.applied).toBe(false)
    expect(out.balanceDiffs).toHaveLength(1)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(123)
    expect(await auditActions(db, ORG)).toEqual([])
  })

  it('apply repairs balances and rollups, removes stale rollup documents, audits and releases the lock', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 1000, paymentDate: '2026-10-20', categoryId: 'ci1' }))
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 123 })
    await db.doc(`organizations/${ORG}/rollups/cash_pln1_2026-10-20`).update({ inMinor: 5 })
    await db.doc(`organizations/${ORG}/rollups/pl_1999-01`).set({ categories: { x: { incomeBase: 9 } } })

    const out = await rebuildLedger(deps, ORG, UID, { apply: true })
    expect(out.applied).toBe(true)
    expect(out.ok).toBe(false)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(101000)
    expect(await readDoc(db, `organizations/${ORG}/rollups/pl_1999-01`)).toBeUndefined()
    expect(await auditActions(db, ORG)).toEqual(['ledger.rebuild', 'tx.create'])
    // the lock is gone: writes work
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 1, paymentDate: '2026-10-20' }))
  })

  it('refuses while someone else holds the lock', async () => {
    await acquireLock(deps, ORG, 'other')
    expect(await code(rebuildLedger(deps, ORG, UID, { apply: true }))).toBe('ledger_busy')
  })
)
```


- [ ] **Step 5: Run, typecheck, lint, commit**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:integration && npx vitest run --config vitest.config.ts tests/unit/domain/ledger && npm run typecheck && npm run lint`
Expected: PASS. A failure of the random test means `write.ts` or the domain is wrong; investigate the failing seed.

```bash
git add -A
git commit -m "feat(ledger): verifyLedger and rebuildLedger

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: API routes and server wiring

**Model:** sonnet

**Files:**
- Create: `lib/server/request-body.ts`, `lib/server/ledger/http.ts`, `lib/server/ledger/index.ts`
- Create: `app/api/orgs/[orgId]/route.ts`, `app/api/orgs/[orgId]/transactions/route.ts`, `app/api/orgs/[orgId]/transactions/[txId]/route.ts`, `app/api/orgs/[orgId]/accounts/route.ts`, `app/api/orgs/[orgId]/accounts/[accountId]/route.ts`, `app/api/orgs/[orgId]/ledger/rebuild/route.ts`
- Modify: `app/api/orgs/route.ts` (use the shared body reader)
- Create: `tests/unit/server/request-body.test.ts`, `tests/unit/server/ledger-http.test.ts`, `tests/unit/api/ledger/routes.test.ts`

- [ ] **Step 1: Shared JSON body reader**

`lib/server/request-body.ts` (the same checks `POST /api/orgs` does today, extracted):

```ts
import 'server-only'
import { HttpError } from '@/lib/server/http-error'

/**
 * Reads a JSON request body: 413 over `maxBytes` (declared or actual), 415 unless application/json,
 * 400 `invalid_body` for text that is not JSON.
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = req.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) throw new HttpError(413, 'payload too large')
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported media type')
  }
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, 'payload too large')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid_body')
  }
}
```

Test `tests/unit/server/request-body.test.ts`: build `Request` objects with `new Request('http://localhost/x', {method:'POST', headers, body})` and assert: valid JSON returns the value; wrong content-type 415; text over the cap 413 (use a small cap); declared content-length over the cap 413; invalid JSON 400 `invalid_body` (check `HttpError.status` and `.message`).

Refactor `app/api/orgs/route.ts`: replace the inline reading (lines from `const declaredLength` to the `JSON.parse` try/catch) with `const body = await readJsonBody(req, MAX_BODY_BYTES)` and drop the now unused `HttpError` import if lint says so. Run `npx vitest run --config vitest.config.ts tests/unit/api/orgs` to confirm behavior is unchanged.

- [ ] **Step 2: Error mapping**

`lib/server/ledger/http.ts`:

```ts
import { LedgerError, type LedgerErrorCode } from '@/lib/domain/ledger/errors'
import { FxError, type FxErrorCode } from '@/lib/server/fx/types'
import { HttpError } from '@/lib/server/http-error'

const LEDGER_STATUS: Record<LedgerErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  account_not_found: 422,
  category_not_found: 422,
  currency_mismatch: 422,
  future_actual: 422,
  account_has_operations: 409,
  currency_locked: 409,
  ledger_busy: 409,
  conflict: 409,
}

const FX_STATUS: Record<FxErrorCode, [number, string]> = {
  invalid_params: [400, 'invalid_input'],
  unsupported_currency: [422, 'rate_unavailable'],
  no_rate_before: [422, 'rate_unavailable'],
  provider_unavailable: [503, 'provider_unavailable'],
}

/** LedgerError and FxError become an HttpError with a short code; everything else passes through unchanged. */
export function toHttpError(e: unknown): unknown {
  if (e instanceof LedgerError) return new HttpError(LEDGER_STATUS[e.code], e.code)
  if (e instanceof FxError) {
    const [status, message] = FX_STATUS[e.code]
    return new HttpError(status, message)
  }
  return e
}
```

Test `tests/unit/server/ledger-http.test.ts`: table test over every `LedgerErrorCode` and `FxErrorCode` checking `status` and `message`, and that an unrelated `Error` is returned as is.

- [ ] **Step 3: Server wiring**

`lib/server/ledger/index.ts`:

```ts
import 'server-only'
import { toDay } from '@/lib/domain/ledger/days'
import type { AccountInput, AccountPatch, OrgPatch } from '@/lib/domain/ledger/entity-input'
import type { TransactionInput, TransactionPatch } from '@/lib/domain/ledger/input'
import { getAdmin } from '@/lib/server/firebase-admin'
import { resolveRate } from '@/lib/server/fx'
import { todayUtcDay } from '@/lib/utils/today'
import { createAccount, deleteAccount, updateAccount } from './accounts'
import type { LedgerDeps } from './deps'
import { updateOrganization } from './org'
import { rebuildLedger } from './rebuild'
import { createTransaction, deleteTransaction, updateTransaction } from './write'

export type { LedgerReport } from './verify'

function deps(): LedgerDeps {
  return { db: getAdmin().db, resolveRate, now: () => new Date(), today: () => toDay(todayUtcDay()) }
}

/** The ledger bound to the production Firestore, NBP rates and the Warsaw clock. */
export const ledger = {
  createTransaction: (orgId: string, uid: string, input: TransactionInput) => createTransaction(deps(), orgId, uid, input),
  updateTransaction: (orgId: string, uid: string, txId: string, patch: TransactionPatch) => updateTransaction(deps(), orgId, uid, txId, patch),
  deleteTransaction: (orgId: string, uid: string, txId: string) => deleteTransaction(deps(), orgId, uid, txId),
  createAccount: (orgId: string, uid: string, input: AccountInput) => createAccount(deps(), orgId, uid, input),
  updateAccount: (orgId: string, uid: string, accountId: string, patch: AccountPatch) => updateAccount(deps(), orgId, uid, accountId, patch),
  deleteAccount: (orgId: string, uid: string, accountId: string) => deleteAccount(deps(), orgId, uid, accountId),
  updateOrganization: (orgId: string, uid: string, patch: OrgPatch) => updateOrganization(deps(), orgId, uid, patch),
  rebuild: (orgId: string, uid: string, apply: boolean) => rebuildLedger(deps(), orgId, uid, { apply }),
}
```

- [ ] **Step 4: Routes**

Every route follows this shape. `app/api/orgs/[orgId]/transactions/route.ts`:

```ts
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { ledger } from '@/lib/server/ledger'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/transactions  (owner, accountant)
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseTransactionInput(await readJsonBody(req, MAX_BODY_BYTES))
    const { transaction, replayed } = await ledger.createTransaction(orgId, uid, input)
    return Response.json({ transaction }, { status: replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
```

`app/api/orgs/[orgId]/transactions/[txId]/route.ts`: `type Ctx = { params: Promise<{ orgId: string; txId: string }> }`. `PATCH`: requireUser, params, requireOrgRole owner/accountant, `isId(txId)` else `throw new HttpError(404, 'not_found')`, `parseTransactionPatch(await readJsonBody(...))`, `ledger.updateTransaction`, `Response.json({ transaction })` with `Cache-Control: no-store`. `DELETE`: same guards, `ledger.deleteTransaction`, `new Response(null, { status: 204 })`.

`app/api/orgs/[orgId]/accounts/route.ts`: `POST` with `parseAccountInput`, `ledger.createAccount`, returns `Response.json({ account }, { status: 201, ... })`.
`app/api/orgs/[orgId]/accounts/[accountId]/route.ts`: `PATCH` (`parseAccountPatch`, `ledger.updateAccount`, `{ account }`), `DELETE` (204). Both check `isId(accountId)` (404 otherwise).
`app/api/orgs/[orgId]/route.ts`: `PATCH`, **owner only** (`requireOrgRole(uid, orgId, ['owner'])`), `parseOrgPatch`, `ledger.updateOrganization`, `Response.json({ organization })`.
`app/api/orgs/[orgId]/ledger/rebuild/route.ts`: `POST`, owner only. The only allowed query parameter is `apply` with value `0` or `1` (default `0`); anything else is `HttpError(400, 'invalid_params')`. No body is read. Returns `Response.json({ report })`. Use `ledger.rebuild(orgId, uid, apply)`.

Import `isId` from `@/lib/domain/ledger/guards`, `HttpError` from `@/lib/server/http-error`. Every handler must contain `await requireUser(req)` literally (the `route-auth-coverage` test scans for it).

- [ ] **Step 5: Route tests**

`tests/unit/api/ledger/routes.test.ts` mocks the ledger and runs the real auth against the fake Admin (alice owner, carol accountant, dave viewer, mallory outsider of `org-acme`; tokens `token-<name>`; see `tests/unit/helpers/fake-admin.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { FxError } from '@/lib/server/fx/types'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { ledger } from '@/lib/server/ledger'
import { PATCH as patchOrg } from '@/app/api/orgs/[orgId]/route'
import { POST as postTx } from '@/app/api/orgs/[orgId]/transactions/route'
import { DELETE as deleteTx, PATCH as patchTx } from '@/app/api/orgs/[orgId]/transactions/[txId]/route'
import { POST as postAccount } from '@/app/api/orgs/[orgId]/accounts/route'
import { DELETE as deleteAccount, PATCH as patchAccount } from '@/app/api/orgs/[orgId]/accounts/[accountId]/route'
import { POST as rebuild } from '@/app/api/orgs/[orgId]/ledger/rebuild/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/ledger', () => ({
  ledger: {
    createTransaction: vi.fn(), updateTransaction: vi.fn(), deleteTransaction: vi.fn(),
    createAccount: vi.fn(), updateAccount: vi.fn(), deleteAccount: vi.fn(),
    updateOrganization: vi.fn(), rebuild: vi.fn(),
  },
}))

const TX = { id: 't1', type: 'income' }
const BODY_TX = { type: 'income', accountId: 'acc1', amountMinor: 1000, paymentDate: '2026-10-20' }

function req(method: string, path: string, body?: unknown, token: string | null = 'token-alice'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}
const ctx = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ orgId: 'org-acme', ...extra }) })

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(ledger)) vi.mocked(fn).mockReset()
})
```

Cover with `describe`/`it` (write each as a real test, not a table of names):
1. For every route (`postTx`, `patchTx`, `deleteTx`, `postAccount`, `patchAccount`, `deleteAccount`, `patchOrg`, `rebuild`): `it.each` that no session gives 401, `token-mallory` (not a member) gives 403, and `token-dave` (viewer) gives 403, and that the matching `ledger.*` mock was not called.
2. `patchOrg` and `rebuild`: `token-carol` (accountant) gives 403; `token-alice` is allowed.
3. `postTx`: alice and carol get 201 with `{ transaction }`, and the mock was called with `('org-acme', 'user-alice', <parsed input>)`; a replayed result (`replayed: true`) gives 200; a body with an unknown key gives 400 `invalid_input` and the mock is not called; a non-JSON body gives 400 `invalid_body`.
4. `patchTx`: calls `ledger.updateTransaction('org-acme', 'user-alice', 't1', patch)`; an id with a dot (`'a.b'`) gives 404; an empty patch gives 400.
5. `deleteTx`, `deleteAccount`: 204 with an empty body.
6. `postAccount` 201 `{ account }`; `patchAccount` 200; `patchOrg` 200 `{ organization }`.
7. `rebuild`: default `apply=0` calls `ledger.rebuild('org-acme', 'user-alice', false)`; `?apply=1` calls it with `true`; `?apply=2` and `?x=1` give 400 `invalid_params`.
8. Error mapping: mock `ledger.createTransaction` to reject with `new LedgerError('ledger_busy')` gives 409 `{error:'ledger_busy'}`; `new LedgerError('future_actual','paymentDate')` gives 422; `new FxError('provider_unavailable')` gives 503 `{error:'provider_unavailable'}`; a plain `Error('boom')` gives 500 `{error:'internal'}`.

- [ ] **Step 6: Run everything, commit**

Run: `npx vitest run --config vitest.config.ts` (the whole unit suite, includes `route-auth-coverage`), `npm run typecheck`, `npm run lint`, `npm run check:server-imports`
Expected: PASS (`route-auth-coverage` must list the new routes as authenticated).

```bash
git add -A
git commit -m "feat(ledger): API routes for operations, accounts, company settings and rebuild

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


---

### Task 10: Firestore rules, indexes and rules tests

**Model:** sonnet

**Files:**
- Modify: `firestore.rules`, `firestore.indexes.json`
- Modify: `tests/rules/firestore.rules.test.ts`, `tests/rules/client-sdk.test.ts` (as the failures require), `scripts/verify-firestore-rules.mjs` (as required, see Step 5)

- [ ] **Step 1: Replace the organization block in `firestore.rules`**

Remove the `orgFieldsValid` function (it becomes unused). Replace the whole `match /organizations/{orgId} { ... }` block (from `match /organizations/{orgId} {` down to its closing brace before the `// "My companies"` comment) with:

```
    match /organizations/{orgId} {
      // Any member may read the company. There is no `list` (companies are loaded by id from the caller's
      // memberships) and no client `create`, `update` or `delete`: the name and currency change through
      // PATCH /api/orgs/{orgId} (S05), which freezes the currency once there are operations.
      allow get: if hasRole(orgId, ['owner', 'accountant', 'viewer']);

      // Memberships are written by the server only.
      match /members/{memberId} {
        allow get: if isSignedIn() && (request.auth.uid == memberId || hasRole(orgId, ['owner']));
        allow list: if hasRole(orgId, ['owner']);
      }

      match /{subcollection}/{docId} {
        allow read: if (subcollection in ['accounts', 'categories', 'transactions', 'rollups']
            && hasRole(orgId, ['owner', 'accountant', 'viewer']))
          || (subcollection in ['bankConnections', 'audit'] && hasRole(orgId, ['owner']));

        // The browser writes categories and bank connections only. Accounts, transactions, rollups and the
        // audit log are written by the server (S05, lib/server/ledger); `ledger/lock` is server-only too.
        allow create, update: if (subcollection == 'categories'
            && hasRole(orgId, ['owner', 'accountant'])
            && orgIdMatchesPath(orgId))
          || (subcollection == 'bankConnections'
            && hasRole(orgId, ['owner'])
            && orgIdMatchesPath(orgId));

        allow delete: if (subcollection == 'categories' && hasRole(orgId, ['owner', 'accountant']))
          || (subcollection == 'bankConnections' && hasRole(orgId, ['owner']));
      }
    }
```

Update the header comment of the file: the data-shape list becomes `organizations/{orgId}/{accounts|categories|transactions|rollups|audit|bankConnections|ledger}/{docId}`, and add the sentence "Accounts, transactions, rollups, audit and ledger are written by the server only (S05)."

- [ ] **Step 2: Indexes**

In `firestore.indexes.json` keep the three existing `transactions` indexes (they serve the pre-migration code until the cleanup step) and add three with `paymentDate` in place of `date`:

```json
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "accountId", "order": "ASCENDING" },
        { "fieldPath": "paymentDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "categoryId", "order": "ASCENDING" },
        { "fieldPath": "paymentDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "accountId", "order": "ASCENDING" },
        { "fieldPath": "categoryId", "order": "ASCENDING" },
        { "fieldPath": "paymentDate", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 3: Update the rules tests to the new matrix**

Read `tests/rules/firestore.rules.test.ts` fully, then change it so it asserts exactly this (keep the existing helpers and seeding; seed v2-shaped data where a document shape matters, but the rules do not look inside accounts/transactions):

| Path | owner | accountant | viewer | non-member |
|---|---|---|---|---|
| `accounts/*`, `transactions/*`, `rollups/*`: read | allow | allow | allow | deny |
| `accounts/*`, `transactions/*`, `rollups/*`, `audit/*`: create, update, delete | deny | deny | deny | deny |
| `audit/*`: read | allow | deny | deny | deny |
| `ledger/lock`: read and write | deny | deny | deny | deny |
| `categories/*`: read | allow | allow | allow | deny |
| `categories/*`: create, update, delete | allow | allow | deny | deny |
| `bankConnections/*` | unchanged (owner only) | | | |
| `organizations/{id}` get | allow | allow | allow | deny |
| `organizations/{id}` update (name or currency) and delete | deny | deny | deny | deny |

Keep the existing cross-organization isolation tests (a member of org A reading or writing org B's data) and the `orgId` mismatch test, but run the mismatch test against `categories`. Replace the old "owner may update name/currency" and "update allow-list" tests with the single "nobody updates the organization from a client" test above. Keep the tests for `members`, `_meta` and `fxTables` as they are.

Fix `tests/rules/client-sdk.test.ts` where it writes `accounts` or `transactions` from a client: seed through the privileged test context (`withSecurityRulesDisabled`) instead and keep what the file really tests (the modular client SDK talking to the rules).

- [ ] **Step 4: Run the rules suite**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:rules`
Expected: PASS.

- [ ] **Step 5: The production rules verifier**

Run: `grep -n "transactions\|accounts\|update" scripts/verify-firestore-rules.mjs`
Update that script's expectations to the new matrix wherever it asserts a client write to `accounts`, `transactions` or the organization document (it is run against production after a rules deploy; a stale expectation would fail the rollout). Also update its unit test if one exists under `tests/unit/scripts/`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ledger): close client writes to accounts, transactions, rollups, audit; add paymentDate indexes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Client: API client, read mappers, forms

**Model:** sonnet

**Files:**
- Modify: `types/index.ts`, `lib/firebase/transactions.ts`, `lib/firebase/accounts.ts`, `components/forms/TransactionForm.tsx`, `components/forms/AccountForm.tsx`, `components/shell/AccountsSidebar.tsx`, `app/(app)/[orgSlug]/settings/company/page.tsx`, `components/transactions/TransactionList.tsx`, `messages/uk.json`, `messages/pl.json`, `messages/en.json`, every other consumer and test fixture the compiler reports
- Create: `lib/api/ledger-client.ts`, `lib/firebase/ledger-map.ts`, `tests/unit/api/ledger-client.test.ts`, `tests/unit/firebase/ledger-map.test.ts`, `tests/unit/helpers/fixtures.ts`

- [ ] **Step 1: UI types**

In `types/index.ts` import `Accrual` and `TxStatus` from `@/lib/domain/ledger/types` and replace `Account` and `Transaction`:

```ts
export interface Account {
  id: string
  orgId: string
  name: string
  type: 'bank' | 'cash' | 'card' | 'crypto'
  /** Current balance: opening balance plus the actual operations. */
  balance: number
  /** Opening balance. */
  opening: number
  currency: string
  color: string
}

export interface Transaction {
  id: string
  orgId: string
  accountId: string
  type: 'income' | 'expense' | 'transfer'
  status: TxStatus
  amount: number
  currency: string
  /** Transfers only. */
  toAccountId?: string
  toAmount?: number
  toCurrency?: string
  categoryId?: string
  counterpartyId?: string
  /** The payment date as a Date at 00:00 UTC. */
  date: Date
  accrual: Accrual
  description?: string
  isRecurring: boolean
  projectId?: string
  tags: string[]
  fileUrls: string[]
}
```

- [ ] **Step 2: Read mappers and their tests**

`lib/firebase/ledger-map.ts`:

```ts
import { fromDay } from '@/lib/domain/ledger/days'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { Account, Transaction } from '@/types'

export function toUiAccount(orgId: string, a: LedgerAccount): Account {
  return {
    id: a.id,
    orgId,
    name: a.name,
    type: a.type,
    currency: a.currency,
    color: a.color,
    balance: fromMinor(a.balanceMinor),
    opening: fromMinor(a.openingMinor),
  }
}

export function toUiTransaction(orgId: string, tx: LedgerTransaction): Transaction {
  const ui: Transaction = {
    id: tx.id,
    orgId,
    accountId: tx.accountId,
    type: tx.type,
    status: tx.status,
    amount: fromMinor(tx.amountMinor),
    currency: tx.currency,
    date: fromDay(tx.paymentDate),
    accrual: tx.accrual,
    isRecurring: tx.isRecurring,
    tags: tx.tags,
    fileUrls: tx.fileUrls,
  }
  if (tx.toAccountId !== undefined) ui.toAccountId = tx.toAccountId
  if (tx.toAmountMinor !== undefined) ui.toAmount = fromMinor(tx.toAmountMinor)
  if (tx.toCurrency !== undefined) ui.toCurrency = tx.toCurrency
  if (tx.categoryId !== undefined) ui.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) ui.counterpartyId = tx.counterpartyId
  if (tx.description !== undefined) ui.description = tx.description
  if (tx.projectId !== undefined) ui.projectId = tx.projectId
  return ui
}
```

`tests/unit/firebase/ledger-map.test.ts`: one test per mapper: a v2 `LedgerAccount` (opening 10000, balance 12345) maps to `{ balance: 123.45, opening: 100 }`; a transfer `LedgerTransaction` with `toAmountMinor: 1000` maps to `toAmount: 10`, `date` equals `new Date('2026-10-20T00:00:00Z')`, optional fields that are absent are absent (no `undefined` keys: `expect('categoryId' in ui).toBe(false)`).

- [ ] **Step 3: Make `lib/firebase/transactions.ts` and `accounts.ts` read-only**

Replace `lib/firebase/transactions.ts` with:

```ts
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type CollectionReference,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { toDay } from '@/lib/domain/ledger/days'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import type { Transaction } from '@/types'
import { db } from './firebase'
import { toUiTransaction } from './ledger-map'

export interface TransactionFilters {
  accountId?: string
  categoryId?: string
  dateFrom?: Date
  dateTo?: Date
  amountMin?: number
  amountMax?: number
  search?: string
}

function txsRef(orgId: string): CollectionReference {
  return collection(db, 'organizations', orgId, 'transactions')
}

/**
 * Operations are written by the server only (lib/api/ledger-client.ts calls it); the browser reads
 * them here. Documents that are not schema 2 are skipped and counted in the console. Planned
 * operations are not listed: nothing in the UI creates them yet, and the forecast (S13) reads them itself.
 */
function toTransactions(orgId: string, docs: QueryDocumentSnapshot[]): Transaction[] {
  const out: Transaction[] = []
  let skipped = 0
  for (const d of docs) {
    const tx = parseTransaction(d.id, d.data())
    if (!tx) skipped++
    else if (tx.status === 'actual') out.push(toUiTransaction(orgId, tx))
  }
  if (skipped > 0) console.warn(`transactions: skipped ${skipped} unreadable document(s) in ${orgId}`)
  return out
}

export function getTransactions(
  orgId: string,
  filters: TransactionFilters,
  callback: (txs: Transaction[]) => void,
): Unsubscribe {
  let q: Query = query(txsRef(orgId), orderBy('paymentDate', 'desc'))

  if (filters.accountId) q = query(q, where('accountId', '==', filters.accountId))
  if (filters.categoryId) q = query(q, where('categoryId', '==', filters.categoryId))
  if (filters.dateFrom) q = query(q, where('paymentDate', '>=', toDay(filters.dateFrom)))
  if (filters.dateTo) q = query(q, where('paymentDate', '<=', toDay(filters.dateTo)))

  return onSnapshot(q, (snap) => {
    let txs = toTransactions(orgId, snap.docs)

    // Client-side filters (amount, search)
    if (filters.amountMin !== undefined) txs = txs.filter((tx) => tx.amount >= filters.amountMin!)
    if (filters.amountMax !== undefined) txs = txs.filter((tx) => tx.amount <= filters.amountMax!)
    if (filters.search) {
      const s = filters.search.toLowerCase()
      txs = txs.filter(
        (tx) => tx.description?.toLowerCase().includes(s) || tx.counterpartyId?.toLowerCase().includes(s),
      )
    }

    callback(txs)
  })
}
```

Replace `lib/firebase/accounts.ts` with:

```ts
import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { parseAccount } from '@/lib/domain/ledger/doc'
import type { Account } from '@/types'
import { db } from './firebase'
import { toUiAccount } from './ledger-map'

/** Accounts are written by the server only (lib/api/ledger-client.ts); the browser reads them here. */
export function getAccounts(orgId: string, callback: (accounts: Account[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'organizations', orgId, 'accounts'), (snap) => {
    const accounts: Account[] = []
    let skipped = 0
    for (const d of snap.docs) {
      const account = parseAccount(d.id, d.data())
      if (account) accounts.push(toUiAccount(orgId, account))
      else skipped++
    }
    if (skipped > 0) console.warn(`accounts: skipped ${skipped} unreadable document(s) in ${orgId}`)
    callback(accounts)
  })
}
```

- [ ] **Step 4: The API client and its tests**

`lib/api/ledger-client.ts`:

```ts
import { fullPatch } from '@/lib/domain/ledger/input'
import { toMinor } from '@/lib/domain/ledger/money'
import type { Accrual, AccountType, TxStatus, TxType } from '@/lib/domain/ledger/types'

/** A failed call: the HTTP status and the short error code the server answered with. */
export class LedgerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code)
    this.name = 'LedgerApiError'
  }
}

export interface TransactionDraft {
  type: TxType
  status?: TxStatus
  accountId: string
  /** In the currency of the account, 2 decimals. */
  amount: number
  toAccountId?: string
  toAmount?: number
  paymentDate: string
  accrual?: Accrual
  categoryId?: string
  counterpartyId?: string
  description?: string
  isRecurring: boolean
  projectId?: string
  tags: string[]
  fileUrls: string[]
}

export interface AccountDraft {
  name: string
  type: AccountType
  currency: string
  color: string
  /** Opening balance, 2 decimals. */
  opening: number
}

/** The request body for a draft (minor units, no undefined keys). */
export function draftToBody(d: TransactionDraft, clientId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: d.type,
    accountId: d.accountId,
    amountMinor: toMinor(d.amount),
    paymentDate: d.paymentDate,
    isRecurring: d.isRecurring,
    tags: d.tags,
    fileUrls: d.fileUrls,
  }
  if (clientId !== undefined) body.clientId = clientId
  if (d.status !== undefined) body.status = d.status
  if (d.toAccountId !== undefined) body.toAccountId = d.toAccountId
  if (d.toAmount !== undefined) body.toAmountMinor = toMinor(d.toAmount)
  if (d.accrual !== undefined) body.accrual = d.accrual
  if (d.categoryId !== undefined) body.categoryId = d.categoryId
  if (d.counterpartyId !== undefined) body.counterpartyId = d.counterpartyId
  if (d.description !== undefined) body.description = d.description
  if (d.projectId !== undefined) body.projectId = d.projectId
  return body
}

/** The PATCH body that makes the stored operation equal the draft: absent optional fields are cleared. */
export function draftToPatch(d: TransactionDraft): Record<string, unknown> {
  return fullPatch(draftToBody(d))
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let code = 'unknown'
    try {
      const json = (await res.json()) as { error?: unknown }
      if (typeof json.error === 'string') code = json.error
    } catch {
      // Not JSON: keep 'unknown'.
    }
    throw new LedgerApiError(res.status, code)
  }
  return res.status === 204 ? null : res.json()
}

const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`

/** `clientId` makes a retry or a double click create the operation once. */
export async function createTransaction(orgId: string, draft: TransactionDraft, clientId?: string): Promise<string> {
  const out = (await call('POST', `${org(orgId)}/transactions`, draftToBody(draft, clientId))) as { transaction: { id: string } }
  return out.transaction.id
}

export async function updateTransaction(orgId: string, txId: string, draft: TransactionDraft): Promise<void> {
  await call('PATCH', `${org(orgId)}/transactions/${encodeURIComponent(txId)}`, draftToPatch(draft))
}

export async function deleteTransaction(orgId: string, txId: string): Promise<void> {
  await call('DELETE', `${org(orgId)}/transactions/${encodeURIComponent(txId)}`)
}

const accountBody = (d: Partial<AccountDraft>) => {
  const { opening, ...rest } = d
  return opening === undefined ? rest : { ...rest, openingMinor: toMinor(opening) }
}

export async function createAccount(orgId: string, draft: AccountDraft): Promise<string> {
  const out = (await call('POST', `${org(orgId)}/accounts`, accountBody(draft))) as { account: { id: string } }
  return out.account.id
}

export async function updateAccount(orgId: string, accountId: string, patch: Partial<AccountDraft>): Promise<void> {
  await call('PATCH', `${org(orgId)}/accounts/${encodeURIComponent(accountId)}`, accountBody(patch))
}

export async function deleteAccount(orgId: string, accountId: string): Promise<void> {
  await call('DELETE', `${org(orgId)}/accounts/${encodeURIComponent(accountId)}`)
}

export async function updateOrganization(orgId: string, patch: { name?: string; currency?: string }): Promise<void> {
  await call('PATCH', org(orgId), patch)
}
```

`tests/unit/api/ledger-client.test.ts` (use `vi.stubGlobal('fetch', vi.fn())`):
- `draftToBody` converts `amount: 1234.6` to `amountMinor: 123460`, omits undefined fields, includes `clientId`, converts `toAmount`.
- `draftToPatch` of a draft without category has `categoryId: null`, `accrual: null`, `description: null`, `toAccountId: null`.
- `createTransaction('o 1', draft, 'client-12345678')` POSTs to `/api/orgs/o%201/transactions` with JSON content type and returns the id from `{ transaction: { id } }`.
- A `409` JSON `{ error: 'ledger_busy' }` rejects with `LedgerApiError` having `status 409`, `code 'ledger_busy'`; a non-JSON error body gives code `'unknown'`.
- `deleteTransaction` resolves on 204 without reading a body; `updateAccount(..., { opening: 12.5 })` sends `openingMinor: 1250`.

- [ ] **Step 5: Messages**

Add these keys to all three catalogs (`uk` is the source of types; the other two must have the same shape). Find the existing `forms.transaction`, `forms.account`, `settings.company` objects and the namespace that holds `deleteAccount` (the error toast in AccountsSidebar) and add inside them:

| Key | uk | pl | en |
|---|---|---|---|
| `forms.transaction.amountTo` | Сума зарахування | Kwota na koncie docelowym | Amount received |
| `forms.transaction.errors.amountTo` | Вкажіть суму зарахування | Podaj kwotę na koncie docelowym | Enter the amount received |
| `forms.transaction.errors.save` | Не вдалося зберегти операцію. Спробуйте ще раз. | Nie udało się zapisać operacji. Spróbuj ponownie. | Could not save the transaction. Try again. |
| `forms.account.opening` | Початковий залишок | Saldo początkowe | Opening balance |
| `forms.account.errors.hasOperations` | Валюту рахунку не можна змінити, поки в ньому є операції. | Nie można zmienić waluty konta, dopóki ma operacje. | The account currency cannot be changed while it has transactions. |
| `forms.account.errors.save` | Не вдалося зберегти рахунок. Спробуйте ще раз. | Nie udało się zapisać konta. Spróbuj ponownie. | Could not save the account. Try again. |
| `settings.company.currencyLocked` | Валюту не можна змінити, поки в компанії є операції. | Nie można zmienić waluty, dopóki firma ma operacje. | The currency cannot be changed while the company has transactions. |
| (the namespace with `deleteAccount`) `accountHasOperations` | Рахунок має операції, видалити його не можна. | Konto ma operacje, nie można go usunąć. | The account has transactions and cannot be deleted. |

The existing `forms.account.balance` key stays only if something else uses it; otherwise remove it from the three catalogs when the AccountForm no longer reads it.

- [ ] **Step 6: TransactionForm**

Edit `components/forms/TransactionForm.tsx`:
- Imports: `createTransaction`, `updateTransaction`, `LedgerApiError`, `type TransactionDraft` from `@/lib/api/ledger-client`; `toast` from `sonner`; drop `roundAmount`, the `Select*` imports and the `CURRENCIES` constant once unused.
- Remove the `currency` and `currencyChosen` state and the `currencyOf` helper's role as state initializer. The operation currency is always the account's: `const account = accounts.find((a) => a.id === accountId)`, `const toAccount = accounts.find((a) => a.id === toAccountId)`, `const currency = account?.currency ?? defaultCurrency ?? FALLBACK_CURRENCY`, `const crossCurrency = type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency`.
- `toAccountId` initial state: `transaction?.toAccountId ?? ''`. Add `const [toAmount, setToAmount] = useState(transaction?.toAmount !== undefined ? formatAmountInput(transaction.toAmount, locale) : '')`.
- Replace the currency `Select` block with a read-only label showing `currency` (same grid cell, `<Label>{t('currency')}</Label>` and a `div` styled like the removed trigger). Remove the `onChange` side effect that set the currency from the account.
- When `crossCurrency`, render below the amount row a second field `id="tx-amount-to"` labelled `t('amountTo')` with the target currency (`toAccount.currency`) next to it; error text from `errors.toAmount`.
- `validate()`: add `if (crossCurrency) { const v = parseAmountInput(toAmount); if (v === null || v <= 0) errs.toAmount = t('errors.amountTo') }`.
- Replace `buildData` with `buildDraft(): TransactionDraft` returning `{ type, accountId, amount: parseAmountInput(amount) ?? 0, paymentDate: date, isRecurring, tags: [], fileUrls: [] }` plus the optionals: `categoryId` when set (non-transfer), `toAccountId` when `type === 'transfer'`, `toAmount` when `crossCurrency`, `description` when non-blank. `date` is already the `YYYY-MM-DD` string of the date input, so the payment date is passed through unchanged (the accrual date follows it on the server).
- `handleSubmit`: keep a `clientIdRef = useRef(crypto.randomUUID())`; for a new operation call `createTransaction(orgId, buildDraft(), clientIdRef.current)` and, after a successful create, set `clientIdRef.current = crypto.randomUUID()`; for an edit call `updateTransaction(orgId, transaction.id, buildDraft())`. Wrap in `try/catch`: on `LedgerApiError` (or any error) `toast.error(t('errors.save'))` and return without closing; keep the `finally { setLoading(false) }`.
- The type tabs reset: when `type` changes away from `transfer`, nothing else changes.

- [ ] **Step 7: AccountForm, sidebar, settings, list**

- `components/forms/AccountForm.tsx`: import `createAccount`, `updateAccount`, `LedgerApiError` from `@/lib/api/ledger-client`. The amount field is the opening balance: state initial `formatAmountInput(account?.opening ?? 0, locale)`, label `t('opening')`, and the submitted draft is `{ name: name.trim(), type, currency, color, opening: parseAmountInput(balance) ?? 0 }` (no `roundAmount` needed, `toMinor` rounds). Replace the silent `catch {}` with `toast.error(e instanceof LedgerApiError && e.code === 'account_has_operations' ? t('errors.hasOperations') : t('errors.save'))` and do not close the dialog on failure.
- `components/shell/AccountsSidebar.tsx`: import `deleteAccount` from `@/lib/api/ledger-client`; in the existing `catch` show `tErrors('accountHasOperations')` when the error is a `LedgerApiError` with `code === 'account_has_operations'`, else the existing `tErrors('deleteAccount')`.
- `app/(app)/[orgSlug]/settings/company/page.tsx`: replace `updateDoc(doc(db, 'organizations', orgId), {...})` with `updateOrganization(orgId, { name: trimmedName, currency })`; remove the unused `doc`, `updateDoc`, `db` imports; in the catch show `t('currencyLocked')` for a `LedgerApiError` with `code === 'currency_locked'`, else the existing `t('saveFailed')`.
- `components/transactions/TransactionList.tsx` (and any other file that reads `counterpartyId` as the destination account of a transfer): use `toAccountId` and `toAmount` instead. For a transfer between different currencies show both amounts if the list already shows the destination.

- [ ] **Step 8: Fix every consumer the compiler reports**

Run: `npm run typecheck`
For every error: fix the production code (`Account.opening`, `Transaction.status`/`accrual`/`toAccountId` are new required fields) and the test fixtures. Create `tests/unit/helpers/fixtures.ts` exporting `makeTx(over?: Partial<Transaction>): Transaction` (income, `status: 'actual'`, `accrual: { mode: 'date', date: '2026-10-20' }`, `date: new Date('2026-10-20T00:00:00Z')`, `amount: 100`, `currency: 'PLN'`, `tags: []`, `fileUrls: []`, `isRecurring: false`, `orgId: 'org1'`, `accountId: 'a1'`, `id: 't1'`) and `makeAccount(over?)` (`balance: 0`, `opening: 0`, `currency: 'PLN'`, `type: 'bank'`, `color: '#00c896'`), and use them in the fixtures that break instead of repeating literals.
Then run `npx vitest run --config vitest.config.ts` and `npm run lint`.
Expected: typecheck clean, all unit tests PASS (including `no-hardcoded-text` and the message-catalog shape tests), no new lint errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ledger): client reads schema 2 and writes through the API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end tests

**Model:** sonnet

**Files:**
- Modify: `tests/e2e/app-shell.spec.ts` (seed helpers), any other e2e spec that seeds `accounts`/`transactions`/`balance`, `tests/e2e/api-guards.spec.ts`
- Create: `tests/e2e/ledger.spec.ts`

- [ ] **Step 1: Re-seed the existing specs in schema 2**

In `tests/e2e/app-shell.spec.ts`, change `seedAccount` to write `openingMinor: Math.round(data.balance * 100)`, `balanceMinor: Math.round(data.balance * 100)`, `schemaVersion: 2` (and `type: 'bank'`, `currency`, `color`, `orgId`, `createdAt` as before) and no `balance`. Change `seedIncome` to write the v2 operation fields: `type: 'income'`, `status: 'actual'`, `accountId`, `amountMinor: Math.round(amount * 100)`, `currency: 'UAH'`, `paymentDate: <today as YYYY-MM-DD>`, `accrual: { mode: 'date', date: <same> }`, `description`, `isRecurring: false`, `tags: []`, `fileUrls: []`, `schemaVersion: 2`, `orgId`, `createdAt`. Run `grep -rn "balance\|seedDoc" tests/e2e` and adapt every other seed the same way. Run the whole existing e2e suite first (Step 4) before writing the new spec, to see what else depends on the old shape.

- [ ] **Step 2: API guard**

In `tests/e2e/api-guards.spec.ts` add, next to the existing 401 checks, one check per new endpoint without a session expecting 401: `POST /api/orgs/x/transactions`, `PATCH /api/orgs/x/transactions/t`, `DELETE /api/orgs/x/transactions/t`, `POST /api/orgs/x/accounts`, `PATCH /api/orgs/x/accounts/a`, `DELETE /api/orgs/x/accounts/a`, `PATCH /api/orgs/x`, `POST /api/orgs/x/ledger/rebuild`.

- [ ] **Step 3: The balance scenario**

`tests/e2e/ledger.spec.ts`: model it on `app-shell.spec.ts` (same registration/sign-in helpers, same emulator wiring, Ukrainian UI text as the existing specs use). One test, named `account balance follows every edit of its operations`, drives the real UI:
1. Create an account through the account dialog (name `Monobank`, opening `1000`, currency PLN).
2. Add an income `1234,60` through the transaction form: the account balance in the accounts sidebar reads `2 234,60` (use the sidebar test ids that `app-shell.spec.ts` uses; format as the app does, `2 234,60` with the app's grouping space).
3. Add an income `10` and an expense `10`: the balance is unchanged.
4. Edit the first income to `1234,50`: the balance reads `2 234,50` (the case from the owner's screenshot).
5. Delete that income: the balance reads `1 000,00`.
A second test, `a cross-currency transfer asks for both amounts`: with a PLN and an EUR account, choosing both in the transfer form shows the second amount field; saving without it shows its error; saving with `440` and `100` moves both balances.
A third test: `the browser cannot write operations directly`: from the page context (`page.evaluate` using the app's Firestore client is not available), instead call the Firestore emulator REST API with the user's ID token to create a `transactions` document and expect a permission error (`403`). If obtaining the token is not practical with the existing helpers, skip this test; the rules suite already proves it.

- [ ] **Step 4: Run the full e2e suite**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"` with the env the CI step sets (`NEXT_PUBLIC_USE_EMULATORS=1`, `EB_STATE_SECRET=ci-e2e-only-state-secret`, plus the `NEXT_PUBLIC_FIREBASE_*` dummy values from `.github/workflows/ci.yml`).
Expected: all PASS. For failures caused by the old data shape or by a removed currency selector in the form, fix the spec (the behavior change is intended: the currency is the account's).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(ledger): e2e for balance consistency, cross-currency transfer and API guards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Migration script

**Model:** sonnet

**Files:**
- Create: `scripts/lib/plan-ledger-v2.ts`, `scripts/lib/migrate-ledger-v2.ts`, `scripts/migrate-ledger-v2.ts`
- Create: `tests/unit/scripts/plan-ledger-v2.test.ts`, `tests/integration/migrate-ledger.test.ts`

Read `scripts/migrate-memberships.mjs` and `scripts/lib/migration-guard.mjs` first: the CLI must keep the same production safety (dry run by default, `--apply`, `--project=finflow-e94b5` required for any write against production, emulator never restricted, credentials from `GOOGLE_APPLICATION_CREDENTIALS` or `.secrets/finflow-*-firebase-adminsdk-*.json`, nothing from document contents printed besides counters and ids).

- [ ] **Step 1: The pure planner**

`scripts/lib/plan-ledger-v2.ts`:

```ts
import { fxPlan, type FxRequest } from '@/lib/domain/ledger/build'
import { toDay } from '@/lib/domain/ledger/days'
import { accountToDoc } from '@/lib/domain/ledger/doc'
import { balanceEffects } from '@/lib/domain/ledger/effects'
import { toMinor } from '@/lib/domain/ledger/money'
import { ACCOUNT_TYPES, LEDGER_CURRENCIES, TX_TYPES, type LedgerAccount, type LedgerTransaction } from '@/lib/domain/ledger/types'
import { isDay } from '@/lib/domain/ledger/days'

export interface LegacyDoc {
  id: string
  /** `date` must already be a Date (the caller converts the Firestore Timestamp). */
  data: Record<string, unknown>
}

export interface PlanInput {
  baseCurrency: string
  /** The Warsaw day. */
  today: string
  /** Account documents that are not schema 2 yet. */
  legacyAccounts: LegacyDoc[]
  /** Accounts already schema 2: id -> currency. */
  migratedAccounts: ReadonlyMap<string, string>
  /** Operation documents that are not schema 2 yet. */
  legacyTxs: LegacyDoc[]
  /** Operations a previous run migrated (marker `migratedFrom: 'v1'`); they still count for a legacy account's opening balance. */
  markedTxs: LedgerTransaction[]
  /** Accounts whose opening balance is forced to 0 (balance becomes the sum of operations). */
  resetOpening: ReadonlySet<string>
}

export interface PlannedAccount {
  id: string
  fields: Record<string, unknown>
  legacyBalanceMinor: number
  sumMinor: number
  openingMinor: number
  balanceMinor: number
}

export interface PlannedTx {
  id: string
  tx: LedgerTransaction
  /** Set when the legacy `currency` differed from the account's; kept as `legacy.currency`. */
  legacyCurrency?: string
  fxRequests: FxRequest[]
}

export interface Plan {
  accounts: PlannedAccount[]
  txs: PlannedTx[]
  skipped: Array<{ kind: 'account' | 'tx'; id: string; reason: string }>
  counters: { currencyMismatch: number; transferAmountAssumed: number; futureActual: number }
}

const HEX = /^#[0-9a-fA-F]{6}$/
const DEFAULT_COLOR = '#00c896'

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function planOrg(input: PlanInput): Plan {
  const skipped: Plan['skipped'] = []
  const counters = { currencyMismatch: 0, transferAmountAssumed: 0, futureActual: 0 }
  const known = new Map<string, string>(input.migratedAccounts)

  const legacy: Array<{ id: string; account: LedgerAccount; legacyBalanceMinor: number }> = []
  for (const { id, data } of input.legacyAccounts) {
    const name = str(data.name)?.trim()
    const currency = data.currency
    const balance = data.balance
    if (!name) { skipped.push({ kind: 'account', id, reason: 'invalid_name' }); continue }
    if (!(LEDGER_CURRENCIES as readonly unknown[]).includes(currency)) { skipped.push({ kind: 'account', id, reason: 'invalid_currency' }); continue }
    if (typeof balance !== 'number' || !Number.isFinite(balance) || Math.abs(balance) > 1e11) { skipped.push({ kind: 'account', id, reason: 'invalid_balance' }); continue }
    const type = (ACCOUNT_TYPES as readonly unknown[]).includes(data.type) ? (data.type as LedgerAccount['type']) : 'bank'
    const color = typeof data.color === 'string' && HEX.test(data.color) ? data.color : DEFAULT_COLOR
    const legacyBalanceMinor = toMinor(balance)
    known.set(id, currency as string)
    legacy.push({
      id,
      legacyBalanceMinor,
      account: { id, name, type, currency: currency as string, color, openingMinor: 0, balanceMinor: legacyBalanceMinor },
    })
  }

  const txs: PlannedTx[] = []
  for (const { id, data } of input.legacyTxs) {
    const type = data.type
    const accountId = str(data.accountId)
    const amount = data.amount
    const date = data.date
    if (!(TX_TYPES as readonly unknown[]).includes(type)) { skipped.push({ kind: 'tx', id, reason: 'invalid_type' }); continue }
    if (!accountId || !known.has(accountId)) { skipped.push({ kind: 'tx', id, reason: 'unknown_account' }); continue }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e11) { skipped.push({ kind: 'tx', id, reason: 'invalid_amount' }); continue }
    const amountMinor = toMinor(amount)
    if (amountMinor < 1) { skipped.push({ kind: 'tx', id, reason: 'invalid_amount' }); continue }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) { skipped.push({ kind: 'tx', id, reason: 'invalid_date' }); continue }
    const paymentDate = toDay(date)
    if (!isDay(paymentDate) || paymentDate < '2000-01-01') { skipped.push({ kind: 'tx', id, reason: 'invalid_date' }); continue }

    const currency = known.get(accountId) as string
    const tx: LedgerTransaction = {
      id,
      type: type as LedgerTransaction['type'],
      status: 'actual',
      accountId,
      amountMinor,
      currency,
      paymentDate,
      accrual: { mode: 'date', date: paymentDate },
      isRecurring: data.isRecurring === true,
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [],
      fileUrls: Array.isArray(data.fileUrls) ? data.fileUrls.filter((u): u is string => typeof u === 'string') : [],
    }
    const planned: PlannedTx = { id, tx, fxRequests: [] }

    if (type === 'transfer') {
      const to = str(data.counterpartyId)
      if (!to || !known.has(to)) { skipped.push({ kind: 'tx', id, reason: 'unknown_target' }); continue }
      if (to === accountId) { skipped.push({ kind: 'tx', id, reason: 'same_account' }); continue }
      tx.toAccountId = to
      tx.toCurrency = known.get(to) as string
      tx.toAmountMinor = amountMinor
      if (tx.toCurrency !== currency) counters.transferAmountAssumed++
    } else {
      const categoryId = str(data.categoryId)
      if (categoryId) tx.categoryId = categoryId
      const counterpartyId = str(data.counterpartyId)
      if (counterpartyId) tx.counterpartyId = counterpartyId
    }
    const description = str(data.description)
    if (description) tx.description = description
    const projectId = str(data.projectId)
    if (projectId) tx.projectId = projectId

    if (typeof data.currency === 'string' && data.currency !== currency) {
      planned.legacyCurrency = data.currency
      counters.currencyMismatch++
    }
    if (paymentDate > input.today) counters.futureActual++
    planned.fxRequests = fxPlan(tx, input.baseCurrency, input.today)
    txs.push(planned)
  }

  // Opening balance of a legacy account = legacy balance - sum of the effects of all its operations
  // (the ones being migrated now and the ones a previous run migrated).
  const sums = new Map<string, number>()
  for (const t of [...txs.map((p) => p.tx), ...input.markedTxs]) {
    for (const [accountId, delta] of Object.entries(balanceEffects(t))) sums.set(accountId, (sums.get(accountId) ?? 0) + delta)
  }
  const accounts: PlannedAccount[] = legacy.map(({ id, account, legacyBalanceMinor }) => {
    const sumMinor = sums.get(id) ?? 0
    const reset = input.resetOpening.has(id)
    const openingMinor = reset ? 0 : legacyBalanceMinor - sumMinor
    const balanceMinor = reset ? sumMinor : legacyBalanceMinor
    const final: LedgerAccount = { ...account, openingMinor, balanceMinor }
    return { id, fields: accountToDoc(final), legacyBalanceMinor, sumMinor, openingMinor, balanceMinor }
  })

  return { accounts, txs, skipped, counters }
}
```

(Drop the duplicated `isDay` import line by merging it into the `days` import.)

Tests `tests/unit/scripts/plan-ledger-v2.test.ts` (build helper `acc(id, balance, currency='PLN')` and `legacyTx(id, over)` with `date: new Date('2026-10-20T00:00:00Z')`):
1. The screenshot case: account balance `1234.5`, incomes `1234.6` and `10`, expense `10`: `sumMinor 123460`, `legacyBalanceMinor 123450`, `openingMinor -10`, `balanceMinor 123450`.
2. `resetOpening: new Set(['a'])` gives `openingMinor 0`, `balanceMinor 123460`.
3. A transfer with `counterpartyId` pointing at another account becomes `toAccountId`, `toAmountMinor` equal to the amount; a transfer to an unknown account is skipped `unknown_target`; to itself `same_account`.
4. A transaction whose `currency` differs from its account's: kept, `legacyCurrency` set, `counters.currencyMismatch === 1`, `tx.currency` is the account's.
5. A transaction in EUR on an EUR account with base PLN gets one `fxRequests` entry; one in the base currency gets none.
6. Skips: no `accountId`, unknown account, amount `0`, amount `'5'`, `date` null: each with its reason; invalid legacy account (no name, currency `GBP`, balance `NaN`) skipped with reason.
7. `migratedAccounts` accounts produce no `PlannedAccount` but their transactions are planned; `markedTxs` count toward a legacy account's sum.
8. A date after `today`: `futureActual === 1`, tx still `actual`.

- [ ] **Step 2: The runner**

`scripts/lib/migrate-ledger-v2.ts` exports `migrateOrg(deps, orgId, opts)` and `dropLegacy(deps, orgId, opts)`. Behavior (implement exactly; it imports from `@/lib/server/ledger/*`, no `server-only` modules):

`migrateOrg(deps: LedgerDeps, orgId, opts: { apply: boolean; resetOpening: Set<string> }): Promise<MigrateReport>`
1. Load the org (`baseCurrency`; missing org: throw). Load all `accounts` and `transactions` documents. Partition accounts into schema 2 (`parseAccount` non-null: `migratedAccounts` map id -> currency) and legacy. Partition operations: `parseTransaction` non-null = schema 2 (those with `migratedFrom === 'v1'` in the raw data go to `markedTxs`); everything else is legacy, with `data.date` converted from Timestamp to Date (`toDate()`).
2. `planOrg(...)` with `today = deps.today()`.
3. Resolve the rates the plan needs: collect unique `(from, to, date)` over all `fxRequests`, with `date` capped at today (`min(date, today)`), call `deps.resolveRate` for each, require `final === true`. If any call fails, throw before writing anything. Build the evidence with the same mapping as `write.ts` (`rate, from, to, requestedDate, rateDate, tableNo, source`) and `attachFx` each planned transaction.
4. Build the report: counts of accounts and operations to migrate, `skipped`, `counters`, and `drift` = for each planned account `{ accountId, legacyBalanceMinor, sumMinor, openingMinor }` where `legacyBalanceMinor !== sumMinor`. The report also carries `backup: { accounts: LegacyDoc[], txs: LegacyDoc[] }` (the raw legacy documents that would be changed, with Timestamps as ISO strings) for the CLI to save. If `!opts.apply` return it with `applied: false`.
5. Apply, in this order, so a crash can be re-run safely:
   a. Operations in batches of 300. Each document is written with `set(ref, { ...transactionToDoc(tx), migratedFrom: 'v1', ...(legacyCurrency ? { legacy: { currency: legacyCurrency } } : {}) }, { merge: true })` (legacy fields stay). The same batch also increments `balanceMinor` (`FieldValue.increment`) on every already-schema-2 account touched by the batch, by the summed `balanceEffects` of the batch's operations on that account, so a batch is atomic with its balance effect.
   b. Legacy accounts: `set(ref, planned.fields, { merge: true })` (the legacy `balance` field stays).
   c. `rebuildLedger(deps, orgId, 'migration', { apply: true })`: its report tells how many balances it corrected; put that count in the returned report (`rebuildBalanceFixes`).
   d. One audit entry `migration.v2` with the counters.
6. Idempotent: a second run finds no legacy documents and writes nothing except the rebuild (which finds nothing to fix) and a new audit entry only when something was migrated.

`dropLegacy(deps, orgId, opts: { apply: boolean })`: runs `verifyLedger`; if it is not `ok`, return `{ skipped: 'ledger_not_ok' }` and write nothing. Otherwise, for schema 2 accounts delete the `balance` field and for schema 2 operations delete `date` and `amount`, and for transfers delete `counterpartyId` (`FieldValue.delete()`, batches of 400). Dry run counts only.

- [ ] **Step 3: The CLI**

`scripts/migrate-ledger-v2.ts`: arguments `--apply`, `--drop-legacy`, `--project=finflow-e94b5`, `--rules-deployed`, `--reset-opening=<accountId,accountId>`, `--org=<orgId>` (limit to one company). Rules:
- `--apply` and `--drop-legacy` cannot be combined (exit 2).
- Production guards exactly like `migrate-memberships.mjs`: against production `--apply` needs `--project=finflow-e94b5`; `--drop-legacy` needs `--project=finflow-e94b5` and `--rules-deployed`; the flag check runs before credentials are read; the emulator (`FIRESTORE_EMULATOR_HOST`) uses project `demo-finflow` and no credentials. Reuse `scripts/lib/migration-guard.mjs` if its API fits (it takes `{ emulator, apply, drop, args }`); extend it compatibly if `--drop-legacy` needs a new flag name.
- Build `LedgerDeps`: `db` from the Admin SDK, `now: () => new Date()`, `today: () => toDay(todayUtcDay())`, and `resolveRate` from `createResolver({ store: firestoreFxStore(db), fetchTables: (a, b) => fetchNbpTables(a, b), now: () => Date.now(), today })` (`lib/server/fx/*`; `nbp.ts` imports `server-only`, which resolves to an empty module under `--conditions=react-server`, the flag `npm run migrate:ledger` passes).
- For each company (all, or `--org`): run `migrateOrg` as a dry run first; print one line per company with counters only (ids and numbers, never names, descriptions or amounts beyond the drift lines), then one line per drifting account: `account <id>: legacy=<minor> sum=<minor> opening=<minor>`. With `--apply`, write the backup of the changed documents to `.secrets/ledger-v2-backup-<ISO timestamp>.json` (create the directory if needed; refuse to continue if the write fails), then run `migrateOrg` with `apply: true`.
- Exit code 0 on success, 1 when a company failed (continue with the others, list failed ids at the end), 2 for bad arguments.
- Confirm `.secrets/` is in `.gitignore`; add it if not.

- [ ] **Step 4: Integration test against the emulator**

`tests/integration/migrate-ledger.test.ts` (uses `helpers.ts`; seeds legacy documents directly with `db.doc(...).set(...)`; legacy transaction dates are `Timestamp.fromDate(new Date('2026-10-20T00:00:00Z'))`):
1. Seed an org (PLN), a legacy account `a` (`balance: 1234.5`, PLN), a legacy EUR account `e` (`balance: 10`), legacy transactions: income 1234.6 and 10, expense 10 on `a`; a transfer from `a` to `e` with `counterpartyId: 'e'` (amount 5); an EUR income of 3 on `e` with `currency: 'USD'` (mismatch) and one invalid document. Dry run: no document changes, the report lists the drift line for `a`, the counters, the skipped one.
2. Apply: accounts `a`, `e` are schema 2 with the planned opening/balance; operations are schema 2 with `migratedFrom: 'v1'`; the EUR income has `fx`/`base`; the transfer has `toAccountId: 'e'`; `verifyLedger` is `ok`; the audit has `migration.v2`; legacy fields (`balance`, `date`, `amount`) are still present.
3. Idempotency: a second apply changes nothing (no new audit entry, `verifyLedger` ok).
4. The step-4 scenario: after step 2 add a new legacy-shaped income on `a` (old code writing between the steps) and bump the legacy `balance` field by that amount; apply again: the income is migrated, `balanceMinor` of `a` rose by its amount exactly once, `verifyLedger` ok.
5. `resetOpening`: on a fresh seed, `--reset-opening=a` makes `a` open at 0 with balance equal to the sum.
6. `dropLegacy` on a verified org removes `balance`, `date`, `amount` and the transfer's `counterpartyId`; on an org where `balanceMinor` was tampered with, it refuses (`ledger_not_ok`) and removes nothing.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run --config vitest.config.ts tests/unit/scripts`, `PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:integration`, `npm run typecheck`, `npm run lint`.
Also run the CLI once against the emulator to prove the entry point works: `PATH="$HOME/.jre/temurin-21/bin:$PATH" firebase emulators:exec --only firestore --project demo-finflow "npm run migrate:ledger"` (expected: a dry run over zero companies, exit 0).

```bash
git add -A
git commit -m "feat(ledger): migration script from schema 1 to schema 2

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Documentation and final verification

**Model:** haiku

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-10-27-s05-accounting-engine-design.md`

- [ ] **Step 1: Bring the spec in line with what was built**

Edit the spec: change the status line to "реалізовано в гілці `s05-accounting-engine`, чекає мерджа" and apply these corrections:
1. Rules: the browser no longer updates the organization document at all (name and currency go through `PATCH /api/orgs/{orgId}`); the "Правила Firestore" section and the "Додані під час деталізації" item 2 say so.
2. Rollout order gets a new first step: `firebase deploy --only firestore:indexes --project finflow-e94b5 --account "$FIREBASE_ACCOUNT"` and wait until the three `paymentDate` indexes are READY (probe with a query) before merging; this is the S02 lesson.
3. Migration: the marker `migratedFrom: 'v1'`; flags `--reset-opening=<ids>`, `--drop-legacy`, `--org=<id>`; the opening balance rule (`legacy balance - sum of operations`, so visible balances do not change unless `--reset-opening` is used); an operation whose legacy `currency` differed from its account keeps the account's currency and stores `legacy.currency`; a cross-currency legacy transfer gets `toAmountMinor = amountMinor` (the old data had one amount), counted in the report; operations dated after today stay `actual`; backups go to `.secrets/`.
4. Client: the operation form no longer has a currency selector (the account's currency is used) and asks for the second amount of a cross-currency transfer; the list of operations shows `actual` ones only.

- [ ] **Step 2: CLAUDE.md block**

Read `CLAUDE.md`, find the "Exchange rates (S04)" block and add after it a "Ledger (S05)" block (same style, concise): the domain/server/client split and where each lives; the write rule (every change goes through `lib/server/ledger` in one transaction; never write `accounts`, `transactions`, `rollups`, `audit` from the browser or a script except through those functions); `changeSet` as the single rule (create `+new`, delete `-prior`, update both); money in minor units and the `toMinor` / `fromMinor` boundary; dates are `YYYY-MM-DD`; the accrual snapshot date is capped at today so stored snapshots are final; the ledger lock and `verifyLedger` / `rebuildLedger` (`POST /api/orgs/{org}/ledger/rebuild?apply=0|1`, owner); the currency freeze; test commands (`npm run test:integration` needs the Firestore emulator and Java); the migration script and its flags.

- [ ] **Step 3: PROGRESS.md**

Update: the S04 entry from "awaiting merge" to merged and live (PR #8, rules deployed); add an S05 entry (branch, what is built, test counts you measure in Step 4, what is still to do before merge: indexes deploy, migration dry run with the owner, rollout order); list the open follow-ups from the spec's "Відомі наступні кроки".

- [ ] **Step 4: Final verification (record the real numbers in PROGRESS.md)**

Run, in this order, and paste nothing but the summary lines into your report:
- `npm run typecheck`
- `npm run lint`
- `npm run check:server-imports`
- `npx vitest run --config vitest.config.ts` (unit count)
- `PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:rules` (rules count)
- `PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:integration` (integration count)
- the e2e command from Task 12 Step 4 (e2e count)
- `npm run build`
Expected: everything passes; lint has 0 errors and no more warnings than before this branch (15).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(ledger): S05 spec status, CLAUDE.md block, PROGRESS.md

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** server-only writes (Tasks 6, 7, 9, 10), integer money (2, 11), balance invariant (4, 5, 6, 8), planned operations (6 test, 4 effects), two dates and period spread (2, 4, 6), fx snapshots final-only (3, 6), rollups (4, 6, 8), audit (6, 7, 8), idempotent create (6), ledger lock (6, 8), currency freeze (7, 9, 11), account guards (7, 11), migration and rollout order (13, 14), tests (each task; property tests in 5; integration in 6-8, 13; rules in 10; e2e in 12). `rebuild` endpoint (9).

**Type consistency:** `LedgerTransaction`, `LedgerAccount`, `TransactionInput`, `TransactionPatch`, `RawInput`, `ChangeSet`, `RollupDocs`, `LedgerDeps`, `WriteResult`, `LedgerReport` are defined once (Tasks 2-4, 6, 8) and used with the same names afterwards. `fullPatch` is added in Task 8 and used by Task 11 (`draftToPatch`) and the Task 8 integration test.

**Known judgment calls the implementer must not "fix":** the accrual rate date is capped at today; legacy future-dated operations stay `actual`; planned operations are not shown in the UI list; the operation currency always equals the account currency.
