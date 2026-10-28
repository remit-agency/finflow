# S07: Форма операції, дві дати, план/факт, видалення й undo — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перебудувати форму операції під можливості серверного рушія S05 (дві дати, план/факт, контрагент, курс), додати видалення з undo, захист від втрати даних і перевести кольори форм на токени.

**Architecture:** Чиста логіка стану форми в `lib/domain/transaction-form/` (статус за датою, accrual, валідація, dirty, виведений курс), міст «стан форми → чернетка API» у `lib/api/transaction-draft.ts`, undo через звичайні виклики API (видалення відновлюється створенням з тим самим id, редагування відкочується PATCH-ем зі знімка). Форма розбита на секції в `components/forms/transaction/`. Сервер не змінюється.

**Tech Stack:** Next.js 16, React 19 (React Compiler lint: без setState синхронно в effect), Base UI (Dialog, Tabs), Tailwind 4 токени, next-intl, sonner, Vitest, Playwright на емуляторах.

Спека: `docs/superpowers/specs/2026-10-28-s07-transaction-form-design.md`. Гілка: `s07-transaction-form` (від master, спека вже закомічена).

## Загальні правила для кожної задачі

- Мова коментарів у коді й назв комітів: англійська (як у решті репозиторію). Коментар лише там, де неочевидне «чому».
- Рядок у кінці кожного коміту: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Команди з кореня `F:\AI\finflow`. Unit: `npx vitest run <файл>`. Типи: `npx tsc --noEmit`. Lint: `npm run lint` (базова лінія: 13 попереджень, нових бути не має). Інтеграційні: `npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts <файл>"`. E2E: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test <файл>"`.
- Ніколи не вбивати процеси `node` за іменем образа.
- Емулятори потребують Java: перед командами з `emulators:exec` додати в PATH `C:/Users/Admin/.jre/temurin-21/bin` (лише для оболонки, без змін конфігурації).
- Тести в `tests/unit/**` запускаються в середовищі node (без DOM): логіку компонентів виносимо в чисті функції.
- Дати в стані форми й API: рядки `YYYY-MM-DD`; «сьогодні» = Варшава (`todayDay()`), як на сервері.

## Структура файлів

Нові:
- `lib/domain/transaction-form/status.ts` — статус за датою, «сплачено».
- `lib/domain/transaction-form/accrual.ts` — стан дати транзакції/періоду, побудова й перевірка `Accrual`.
- `lib/domain/transaction-form/rate.ts` — виведений курс переказу, оцінка в PLN, форматування.
- `lib/domain/transaction-form/state.ts` — `FormState`, початковий стан, валідація, dirty.
- `lib/api/transaction-undo.ts` — `restoreTransaction`, `revertTransaction`.
- `lib/api/rates-client.ts` — `fetchRate` для `/api/rates`.
- `lib/hooks/useRatePreview.ts` — підказка курсу з debounce.
- `lib/ui/undo-toast.ts` — тост із кнопкою «Скасувати».
- `components/ui/segmented.tsx` — сегментований перемикач (radiogroup).
- `components/forms/transaction/{TransactionForm,AmountFields,DatesFields,CounterpartyField,StatusField,ConfirmDialog}.tsx`.
- Тести: `tests/unit/domain/transaction-form/{status,accrual,rate,state}.test.ts`, `tests/unit/api/{transaction-undo,rates-client}.test.ts`, `tests/unit/ui/undo-toast.test.ts`, `tests/integration/ledger-restore.test.ts`, `tests/e2e/transaction-form.spec.ts`.

Змінені: `lib/utils/today.ts`, `lib/api/transaction-draft.ts` (+ його тест), `components/forms/TransactionForm.tsx` (стає реекспортом), `components/forms/AccountForm.tsx` (токени), `messages/{pl,en,uk}.json`, існуючі e2e (`ledger.spec.ts`, `smoke.spec.ts`, `app-shell.spec.ts`, `i18n.spec.ts`) якщо їх селектори зламалися, `CLAUDE.md`, `PROGRESS.md`.

---

### Task 1: `todayDay` і правила статусу

**Files:**
- Modify: `lib/utils/today.ts`, `tests/unit/utils/today.test.ts`
- Create: `lib/domain/transaction-form/status.ts`, `tests/unit/domain/transaction-form/status.test.ts`

- [ ] **Step 1: Write the failing tests**

Додати в кінець `tests/unit/utils/today.test.ts` (імпорт `todayDay` додати до наявного імпорту з `@/lib/utils/today`):

```ts
describe('todayDay', () => {
  it('is the Warsaw calendar day as YYYY-MM-DD', () => {
    expect(todayDay(new Date('2026-10-28T12:00:00Z'))).toBe('2026-10-28')
  })

  it('moves to the next day once Warsaw is past midnight while UTC is not', () => {
    // 2026-10-28 23:30 UTC is 00:30 on the 29th in Warsaw (CET, UTC+1).
    expect(todayDay(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29')
  })
})
```

Створити `tests/unit/domain/transaction-form/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { effectiveStatus, isFutureDay, paidDay } from '@/lib/domain/transaction-form/status'

const TODAY = '2026-10-28'

describe('isFutureDay', () => {
  it('is true only for a day after today', () => {
    expect(isFutureDay('2026-10-29', TODAY)).toBe(true)
    expect(isFutureDay('2026-10-28', TODAY)).toBe(false)
    expect(isFutureDay('2026-10-27', TODAY)).toBe(false)
  })

  it('is false while the date field is empty or half typed', () => {
    expect(isFutureDay('', TODAY)).toBe(false)
  })
})

describe('effectiveStatus', () => {
  it('a future payment date is always planned, whatever was chosen', () => {
    expect(effectiveStatus('actual', '2026-11-01', TODAY)).toBe('planned')
    expect(effectiveStatus('planned', '2026-11-01', TODAY)).toBe('planned')
  })

  it('today and the past follow the choice', () => {
    expect(effectiveStatus('actual', TODAY, TODAY)).toBe('actual')
    expect(effectiveStatus('planned', TODAY, TODAY)).toBe('planned')
    expect(effectiveStatus('actual', '2026-01-01', TODAY)).toBe('actual')
  })
})

describe('paidDay', () => {
  it('keeps a payment date that is not in the future', () => {
    expect(paidDay('2026-10-20', TODAY)).toBe('2026-10-20')
    expect(paidDay(TODAY, TODAY)).toBe(TODAY)
  })

  it('replaces a future payment date with today (the server refuses an actual operation in the future)', () => {
    expect(paidDay('2026-12-01', TODAY)).toBe(TODAY)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/utils/today.test.ts tests/unit/domain/transaction-form/status.test.ts`
Expected: FAIL (`todayDay` is not exported; module `status` not found).

- [ ] **Step 3: Implement**

Додати в кінець `lib/utils/today.ts`:

```ts
/** `todayUtcDay` as the `YYYY-MM-DD` string the ledger API and the forms use. */
export function todayDay(now: Date = new Date()): string {
  return todayUtcDay(now).toISOString().slice(0, 10)
}
```

Створити `lib/domain/transaction-form/status.ts`:

```ts
import type { TxStatus } from '@/lib/domain/ledger/types'

/** Days are `YYYY-MM-DD`, so string comparison is date comparison. An empty or half typed value is never "future". */
export function isFutureDay(paymentDate: string, today: string): boolean {
  return paymentDate > today
}

/** A payment date after today forces a planned operation: the server refuses an actual one in the future. */
export function effectiveStatus(chosen: TxStatus, paymentDate: string, today: string): TxStatus {
  return isFutureDay(paymentDate, today) ? 'planned' : chosen
}

/** The payment date of an operation marked as paid: the planned date, or today when that is still ahead. */
export function paidDay(paymentDate: string, today: string): string {
  return isFutureDay(paymentDate, today) ? today : paymentDate
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/utils/today.test.ts tests/unit/domain/transaction-form/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/today.ts lib/domain/transaction-form/status.ts tests/unit/utils/today.test.ts tests/unit/domain/transaction-form/status.test.ts
git commit -m "feat(transaction-form): status rules and todayDay helper"
```

---

### Task 2: Дата транзакції й період (`accrual.ts`)

**Files:**
- Create: `lib/domain/transaction-form/accrual.ts`, `tests/unit/domain/transaction-form/accrual.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  accrualError,
  accrualFor,
  accrualStateOf,
  emptyAccrual,
  type AccrualState,
} from '@/lib/domain/transaction-form/accrual'

const PAY = '2026-10-20'

const on = (over: Partial<AccrualState>): AccrualState => ({ ...emptyAccrual(PAY), on: true, ...over })

describe('emptyAccrual', () => {
  it('is off, follows the payment date, and starts a period on it', () => {
    expect(emptyAccrual(PAY)).toEqual({ on: false, mode: 'date', date: null, from: PAY, to: PAY })
  })
})

describe('accrualFor', () => {
  it('sends nothing while the switch is off (the server then follows the payment date)', () => {
    expect(accrualFor(emptyAccrual(PAY), PAY)).toBeUndefined()
  })

  it('a single date that was not touched follows the payment date', () => {
    expect(accrualFor(on({ mode: 'date' }), '2026-10-25')).toEqual({ mode: 'date', date: '2026-10-25' })
  })

  it('a single date that was typed wins over the payment date', () => {
    expect(accrualFor(on({ mode: 'date', date: '2026-10-01' }), PAY)).toEqual({ mode: 'date', date: '2026-10-01' })
  })

  it('a period sends both ends', () => {
    expect(accrualFor(on({ mode: 'period', from: '2026-10-01', to: '2026-12-31' }), PAY)).toEqual({
      mode: 'period',
      from: '2026-10-01',
      to: '2026-12-31',
    })
  })
})

describe('accrualError', () => {
  it('is null while the switch is off, whatever the hidden fields hold', () => {
    expect(accrualError({ ...emptyAccrual(PAY), from: 'x', to: 'y' }, PAY)).toBeNull()
  })

  it('accepts a valid date and a valid period, including a one-day period', () => {
    expect(accrualError(on({ mode: 'date', date: '2026-10-01' }), PAY)).toBeNull()
    expect(accrualError(on({ mode: 'period', from: '2026-10-01', to: '2026-10-01' }), PAY)).toBeNull()
  })

  it('refuses a date that is not a day or is before 2000', () => {
    expect(accrualError(on({ mode: 'date', date: '2026-13-01' }), PAY)).toBe('accrualDate')
    expect(accrualError(on({ mode: 'date', date: '1999-12-31' }), PAY)).toBe('accrualDate')
    expect(accrualError(on({ mode: 'date', date: '' }), PAY)).toBe('accrualDate')
  })

  it('names the end of a period that is missing or invalid', () => {
    expect(accrualError(on({ mode: 'period', from: '', to: '2026-12-31' }), PAY)).toBe('accrualFrom')
    expect(accrualError(on({ mode: 'period', from: '2026-10-01', to: '' }), PAY)).toBe('accrualTo')
  })

  it('refuses a period that ends before it starts', () => {
    expect(accrualError(on({ mode: 'period', from: '2026-12-31', to: '2026-10-01' }), PAY)).toBe('accrualOrder')
  })
})

describe('accrualStateOf (a stored operation)', () => {
  it('a date equal to the payment date is the same as no own accrual: the switch is off', () => {
    expect(accrualStateOf({ mode: 'date', date: PAY }, PAY)).toEqual(emptyAccrual(PAY))
  })

  it('a different date turns the switch on with that date', () => {
    expect(accrualStateOf({ mode: 'date', date: '2026-10-01' }, PAY)).toEqual({
      on: true,
      mode: 'date',
      date: '2026-10-01',
      from: PAY,
      to: PAY,
    })
  })

  it('a period turns the switch on in period mode', () => {
    expect(accrualStateOf({ mode: 'period', from: '2026-10-01', to: '2026-12-31' }, PAY)).toEqual({
      on: true,
      mode: 'period',
      date: null,
      from: '2026-10-01',
      to: '2026-12-31',
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/domain/transaction-form/accrual.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/domain/transaction-form/accrual.ts`

```ts
import { isDay } from '@/lib/domain/ledger/days'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import type { Accrual } from '@/lib/domain/ledger/types'

/** The «transaction date is different» part of the form: when the operation counts for the P&L. */
export interface AccrualState {
  /** The switch. Off: no own accrual, the server makes it follow the payment date. */
  on: boolean
  mode: 'date' | 'period'
  /** The single accrual date; null while it still follows the payment date. */
  date: string | null
  from: string
  to: string
}

export type AccrualError = 'accrualDate' | 'accrualFrom' | 'accrualTo' | 'accrualOrder'

export function emptyAccrual(paymentDate: string): AccrualState {
  return { on: false, mode: 'date', date: null, from: paymentDate, to: paymentDate }
}

const valid = (day: string): boolean => isDay(day) && day >= MIN_DAY

export function accrualFor(state: AccrualState, paymentDate: string): Accrual | undefined {
  if (!state.on) return undefined
  if (state.mode === 'date') return { mode: 'date', date: state.date ?? paymentDate }
  return { mode: 'period', from: state.from, to: state.to }
}

export function accrualError(state: AccrualState, paymentDate: string): AccrualError | null {
  if (!state.on) return null
  if (state.mode === 'date') return valid(state.date ?? paymentDate) ? null : 'accrualDate'
  if (!valid(state.from)) return 'accrualFrom'
  if (!valid(state.to)) return 'accrualTo'
  return state.from <= state.to ? null : 'accrualOrder'
}

/** The form state of a stored accrual. A date equal to the payment date is the same as having none. */
export function accrualStateOf(accrual: Accrual, paymentDate: string): AccrualState {
  if (accrual.mode === 'period') return { on: true, mode: 'period', date: null, from: accrual.from, to: accrual.to }
  if (accrual.date === paymentDate) return emptyAccrual(paymentDate)
  return { on: true, mode: 'date', date: accrual.date, from: paymentDate, to: paymentDate }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/domain/transaction-form/accrual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/transaction-form/accrual.ts tests/unit/domain/transaction-form/accrual.test.ts
git commit -m "feat(transaction-form): accrual date and period state"
```

---

### Task 3: Виведений курс (`rate.ts`)

**Files:**
- Create: `lib/domain/transaction-form/rate.ts`, `tests/unit/domain/transaction-form/rate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { convertApprox, rateLine } from '@/lib/domain/transaction-form/rate'

describe('rateLine', () => {
  it('names the stronger currency as the base: 440 PLN → 100 EUR is 1 EUR = 4.4 PLN', () => {
    expect(rateLine(440, 'PLN', 100, 'EUR')).toEqual({ base: 'EUR', quote: 'PLN', value: 4.4 })
  })

  it('gives the same line for the opposite direction', () => {
    expect(rateLine(100, 'EUR', 440, 'PLN')).toEqual({ base: 'EUR', quote: 'PLN', value: 4.4 })
  })

  it('is null while an amount is missing or not positive', () => {
    expect(rateLine(0, 'PLN', 100, 'EUR')).toBeNull()
    expect(rateLine(440, 'PLN', 0, 'EUR')).toBeNull()
    expect(rateLine(Number.NaN, 'PLN', 100, 'EUR')).toBeNull()
  })
})

describe('convertApprox', () => {
  it('rounds the converted amount to 2 decimals', () => {
    expect(convertApprox(100, 4.2531)).toBe(425.31)
    expect(convertApprox(10.05, 4.5)).toBe(45.23)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/domain/transaction-form/rate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/domain/transaction-form/rate.ts`

```ts
export interface RateLine {
  /** The currency of which one unit is worth more. */
  base: string
  quote: string
  /** How many `quote` one `base` is worth. */
  value: number
}

/**
 * The rate a transfer between two currencies implies, written the usual way (1 EUR = 4.4 PLN, not
 * 1 PLN = 0.2273 EUR). Null until both amounts are positive numbers.
 */
export function rateLine(spent: number, from: string, received: number, to: string): RateLine | null {
  if (!(spent > 0) || !(received > 0)) return null
  const ratio = received / spent
  return ratio >= 1 ? { base: from, quote: to, value: ratio } : { base: to, quote: from, value: spent / received }
}

/** An amount converted at a rate, for a hint (the server stores the real conversion). */
export function convertApprox(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/domain/transaction-form/rate.test.ts`
Expected: PASS. (Якщо `convertApprox(10.05, 4.5)` дає 45.22 через плаваючу крапку, замінити очікуване на фактичне значення `Math.round(10.05*4.5*100)/100` і лишити тест як регресійний: суть перевірки в округленні до 2 знаків.)

- [ ] **Step 5: Commit**

```bash
git add lib/domain/transaction-form/rate.ts tests/unit/domain/transaction-form/rate.test.ts
git commit -m "feat(transaction-form): implied transfer rate and conversion hint helpers"
```

---

### Task 4: Стан форми, валідація, dirty (`state.ts`)

**Files:**
- Create: `lib/domain/transaction-form/state.ts`, `tests/unit/domain/transaction-form/state.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { emptyAccrual } from '@/lib/domain/transaction-form/accrual'
import { initialFormState, isDirty, validateState, type FormState } from '@/lib/domain/transaction-form/state'
import type { Transaction } from '@/types'

const TODAY = '2026-10-28'
const fmt = (n: number) => String(n).replace('.', ',')

const fresh = (over: Partial<Parameters<typeof initialFormState>[0]> = {}): FormState =>
  initialFormState({ defaultType: 'expense', defaultAccountId: 'a1', today: TODAY, formatAmount: fmt, ...over })

const stored = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  orgId: 'o1',
  accountId: 'a1',
  type: 'expense',
  status: 'actual',
  amount: 120.5,
  currency: 'PLN',
  date: new Date('2026-10-20T00:00:00Z'),
  accrual: { mode: 'date', date: '2026-10-20' },
  isRecurring: false,
  tags: [],
  fileUrls: [],
  ...over,
})

describe('initialFormState', () => {
  it('a new operation: actual, today, the first account, nothing typed, accrual off', () => {
    expect(fresh()).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      toAccountId: '',
      amount: '',
      toAmount: '',
      categoryId: '',
      counterpartyId: '',
      paymentDate: TODAY,
      accrual: emptyAccrual(TODAY),
      description: '',
      isRecurring: false,
    })
  })

  it('a stored operation fills every field, with amounts formatted for the input', () => {
    const state = fresh({
      transaction: stored({ categoryId: 'c1', counterpartyId: 'cp1', description: 'Czynsz', status: 'planned' }),
    })
    expect(state).toMatchObject({
      type: 'expense',
      status: 'planned',
      accountId: 'a1',
      amount: '120,5',
      categoryId: 'c1',
      counterpartyId: 'cp1',
      paymentDate: '2026-10-20',
      description: 'Czynsz',
    })
    expect(state.accrual).toEqual(emptyAccrual('2026-10-20'))
  })

  it('a stored period accrual switches the date section on in period mode', () => {
    const state = fresh({ transaction: stored({ accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' } }) })
    expect(state.accrual).toMatchObject({ on: true, mode: 'period', from: '2026-10-01', to: '2026-12-31' })
  })

  it('a stored transfer keeps both accounts and amounts and has no accrual', () => {
    const state = fresh({
      transaction: stored({ type: 'transfer', toAccountId: 'a2', toAmount: 28, toCurrency: 'EUR', currency: 'PLN' }),
    })
    expect(state).toMatchObject({ type: 'transfer', accountId: 'a1', toAccountId: 'a2', amount: '120,5', toAmount: '28' })
    expect(state.accrual.on).toBe(false)
  })
})

describe('validateState', () => {
  const ok = (over: Partial<FormState> = {}): FormState => ({ ...fresh(), amount: '10', ...over })

  it('a complete operation has no errors', () => {
    expect(validateState(ok(), { crossCurrency: false })).toEqual({})
  })

  it('requires an account and a positive amount', () => {
    expect(validateState(ok({ accountId: '' }), { crossCurrency: false })).toEqual({ accountId: 'account' })
    expect(validateState(ok({ amount: '' }), { crossCurrency: false })).toEqual({ amount: 'amount' })
    expect(validateState(ok({ amount: '0' }), { crossCurrency: false })).toEqual({ amount: 'amount' })
    expect(validateState(ok({ amount: 'abc' }), { crossCurrency: false })).toEqual({ amount: 'amount' })
  })

  it('requires a valid payment date', () => {
    expect(validateState(ok({ paymentDate: '' }), { crossCurrency: false })).toEqual({ paymentDate: 'paymentDate' })
    expect(validateState(ok({ paymentDate: '1999-01-01' }), { crossCurrency: false })).toEqual({ paymentDate: 'paymentDate' })
  })

  it('a transfer needs another account, and the second amount when the currencies differ', () => {
    const transfer = ok({ type: 'transfer', toAccountId: '' })
    expect(validateState(transfer, { crossCurrency: false })).toEqual({ toAccountId: 'toAccount' })
    expect(validateState({ ...transfer, toAccountId: 'a1' }, { crossCurrency: false })).toEqual({ toAccountId: 'sameAccount' })
    expect(validateState({ ...transfer, toAccountId: 'a2' }, { crossCurrency: true })).toEqual({ toAmount: 'amountTo' })
    expect(validateState({ ...transfer, toAccountId: 'a2', toAmount: '2,5' }, { crossCurrency: true })).toEqual({})
  })

  it('checks the accrual of an income or expense only', () => {
    const bad = { ...emptyAccrual(TODAY), on: true, mode: 'period' as const, from: '2026-12-31', to: '2026-10-01' }
    expect(validateState(ok({ accrual: bad }), { crossCurrency: false })).toEqual({ accrual: 'accrualOrder' })
    expect(validateState(ok({ type: 'transfer', toAccountId: 'a2', accrual: bad }), { crossCurrency: false })).toEqual({})
  })
})

describe('isDirty', () => {
  it('is false for an untouched form', () => {
    expect(isDirty(fresh(), fresh())).toBe(false)
  })

  it('is true as soon as any field differs', () => {
    expect(isDirty(fresh(), { ...fresh(), amount: '5' })).toBe(true)
    expect(isDirty(fresh(), { ...fresh(), accrual: { ...emptyAccrual(TODAY), on: true } })).toBe(true)
    expect(isDirty(fresh(), { ...fresh(), status: 'planned' })).toBe(true)
  })

  it('ignores whitespace around the description', () => {
    expect(isDirty({ ...fresh(), description: 'a' }, { ...fresh(), description: ' a ' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/domain/transaction-form/state.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/domain/transaction-form/state.ts`

```ts
import { isDay } from '@/lib/domain/ledger/days'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import type { TxStatus, TxType } from '@/lib/domain/ledger/types'
import {
  accrualError,
  accrualStateOf,
  emptyAccrual,
  type AccrualError,
  type AccrualState,
} from '@/lib/domain/transaction-form/accrual'
import { parseAmountInput } from '@/lib/utils/amount-input'
import type { Transaction } from '@/types'

/** Everything the form edits, as typed. */
export interface FormState {
  type: TxType
  /** What the person chose; a future payment date forces `planned` (see `effectiveStatus`). */
  status: TxStatus
  accountId: string
  toAccountId: string
  amount: string
  toAmount: string
  categoryId: string
  counterpartyId: string
  /** `YYYY-MM-DD`. */
  paymentDate: string
  accrual: AccrualState
  description: string
  isRecurring: boolean
}

export interface InitialStateOptions {
  transaction?: Transaction
  defaultType: TxType
  defaultAccountId: string
  today: string
  /** Formats a stored amount the way the amount input shows it (locale aware). */
  formatAmount: (amount: number) => string
}

export function initialFormState(o: InitialStateOptions): FormState {
  const tx = o.transaction
  if (!tx) {
    return {
      type: o.defaultType,
      status: 'actual',
      accountId: o.defaultAccountId,
      toAccountId: '',
      amount: '',
      toAmount: '',
      categoryId: '',
      counterpartyId: '',
      paymentDate: o.today,
      accrual: emptyAccrual(o.today),
      description: '',
      isRecurring: false,
    }
  }
  const paymentDate = tx.date.toISOString().slice(0, 10)
  return {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId ?? '',
    amount: o.formatAmount(tx.amount),
    toAmount: tx.toAmount !== undefined ? o.formatAmount(tx.toAmount) : '',
    categoryId: tx.categoryId ?? '',
    counterpartyId: tx.counterpartyId ?? '',
    paymentDate,
    accrual: tx.type === 'transfer' ? emptyAccrual(paymentDate) : accrualStateOf(tx.accrual, paymentDate),
    description: tx.description ?? '',
    isRecurring: tx.isRecurring,
  }
}

/** The message keys under `forms.transaction.errors`. */
export type FormErrorMessage = 'account' | 'amount' | 'toAccount' | 'sameAccount' | 'amountTo' | 'paymentDate' | AccrualError
export type FormErrors = Partial<
  Record<'accountId' | 'amount' | 'toAccountId' | 'toAmount' | 'paymentDate' | 'accrual', FormErrorMessage>
>

export function validateState(state: FormState, o: { crossCurrency: boolean }): FormErrors {
  const errors: FormErrors = {}
  if (!state.accountId) errors.accountId = 'account'
  const amount = parseAmountInput(state.amount)
  if (amount === null || amount <= 0) errors.amount = 'amount'
  if (!isDay(state.paymentDate) || state.paymentDate < MIN_DAY) errors.paymentDate = 'paymentDate'
  if (state.type === 'transfer') {
    if (!state.toAccountId) errors.toAccountId = 'toAccount'
    else if (state.toAccountId === state.accountId) errors.toAccountId = 'sameAccount'
    if (o.crossCurrency) {
      const received = parseAmountInput(state.toAmount)
      if (received === null || received <= 0) errors.toAmount = 'amountTo'
    }
  } else {
    const accrual = accrualError(state.accrual, state.paymentDate)
    if (accrual) errors.accrual = accrual
  }
  return errors
}

const SCALAR_FIELDS = [
  'type', 'status', 'accountId', 'toAccountId', 'amount', 'toAmount', 'categoryId', 'counterpartyId',
  'paymentDate', 'isRecurring',
] as const

/** Whether the form holds anything the stored (or empty) baseline does not. Whitespace around the description is not a change. */
export function isDirty(baseline: FormState, current: FormState): boolean {
  if (SCALAR_FIELDS.some((k) => baseline[k] !== current[k])) return true
  if (baseline.description.trim() !== current.description.trim()) return true
  const a = baseline.accrual
  const b = current.accrual
  return a.on !== b.on || a.mode !== b.mode || a.date !== b.date || a.from !== b.from || a.to !== b.to
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/domain/transaction-form/state.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean (ігнорувати помилки лише в gitignored `.next/`).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/transaction-form/state.ts tests/unit/domain/transaction-form/state.test.ts
git commit -m "feat(transaction-form): form state, validation and dirty check"
```

---

### Task 5: Міст стану в чернетку API (`transaction-draft.ts`)

Форма тепер сама володіє статусом, accrual і контрагентом. `buildEditDraft` переносить зі збереженої операції лише те, чого форма не показує (проєкт, теги, файли). Додається `stateToDraft` (стан → чернетка) і `transactionToDraft` (збережена операція → повна чернетка, для undo).

**Files:**
- Modify: `lib/api/transaction-draft.ts`, `tests/unit/api/transaction-draft.test.ts`

- [ ] **Step 1: Rewrite the tests**

Прочитати `tests/unit/api/transaction-draft.test.ts`. Тести `buildCreateDraft` і `categoryAfterTypeChange` залишити як є. Тести `buildEditDraft` переписати під нову семантику (форма володіє accrual і контрагентом): замінити блок `describe('buildEditDraft', …)` повністю на такий (змінні `stored`, `form` оголосити за тим самим зразком, що вже є у файлі; `form` тепер типу `FormOwnedDraft` з усіма полями, які він може нести):

```ts
describe('buildEditDraft', () => {
  it('carries only what the form does not show: project, tags and files', () => {
    const tx = stored({ projectId: 'p1', tags: ['q4'], fileUrls: ['https://x/f.pdf'], counterpartyId: 'c-old' })
    const draft = buildEditDraft(tx, form({ amount: 99 }))
    expect(draft).toMatchObject({ amount: 99, projectId: 'p1', tags: ['q4'], fileUrls: ['https://x/f.pdf'] })
    // the counterparty and accrual now come from the form, never from the stored operation
    expect(draft.counterpartyId).toBeUndefined()
    expect(draft.accrual).toBeUndefined()
  })

  it('sends the counterparty, accrual and status the form holds', () => {
    const draft = buildEditDraft(
      stored(),
      form({ counterpartyId: 'c1', accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' }, status: 'planned' }),
    )
    expect(draft).toMatchObject({
      counterpartyId: 'c1',
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
      status: 'planned',
    })
  })

  it('lets the form clear what it owns (category, description, counterparty)', () => {
    const tx = stored({ categoryId: 'c1', description: 'x', counterpartyId: 'cp1' })
    const patch = draftToPatch(buildEditDraft(tx, form({})))
    expect(patch).toMatchObject({ categoryId: null, description: null, counterpartyId: null })
  })

  it('does not mutate the stored operation through the carried arrays', () => {
    const tx = stored({ tags: ['a'], fileUrls: ['u'] })
    const draft = buildEditDraft(tx, form({}))
    draft.tags.push('b')
    draft.fileUrls.push('v')
    expect(tx.tags).toEqual(['a'])
    expect(tx.fileUrls).toEqual(['u'])
  })
})
```

(`draftToPatch` імпортувати з `@/lib/api/ledger-client`, якщо ще не імпортовано. Якщо наявні хелпери `stored`/`form` у файлі мають іншу форму, адаптувати їх, зберігши змістовні перевірки вище.)

Додати нові блоки:

```ts
describe('stateToDraft', () => {
  const state = (over: Partial<FormState> = {}): FormState => ({
    ...initialFormState({ defaultType: 'expense', defaultAccountId: 'a1', today: '2026-10-28', formatAmount: String }),
    amount: '1 234,50',
    ...over,
  })

  it('an expense: parsed amount, category, counterparty, trimmed description', () => {
    expect(
      stateToDraft(state({ categoryId: 'c1', counterpartyId: 'cp1', description: '  Czynsz ' }), {
        today: '2026-10-28',
        crossCurrency: false,
      }),
    ).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      amount: 1234.5,
      paymentDate: '2026-10-28',
      isRecurring: false,
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
    })
  })

  it('a future payment date is sent as planned, whatever was chosen', () => {
    const draft = stateToDraft(state({ paymentDate: '2026-11-15' }), { today: '2026-10-28', crossCurrency: false })
    expect(draft.status).toBe('planned')
  })

  it('an own accrual is sent only when the switch is on', () => {
    const on = { on: true, mode: 'period' as const, date: null, from: '2026-10-01', to: '2026-12-31' }
    expect(stateToDraft(state({ accrual: on }), { today: '2026-10-28', crossCurrency: false }).accrual).toEqual({
      mode: 'period',
      from: '2026-10-01',
      to: '2026-12-31',
    })
    expect(stateToDraft(state(), { today: '2026-10-28', crossCurrency: false }).accrual).toBeUndefined()
  })

  it('a transfer sends the target account, the second amount only across currencies, and no category, counterparty or accrual', () => {
    const base = state({
      type: 'transfer',
      toAccountId: 'a2',
      toAmount: '100',
      categoryId: 'c1',
      counterpartyId: 'cp1',
      accrual: { on: true, mode: 'date', date: '2026-10-01', from: '', to: '' },
    })
    const same = stateToDraft(base, { today: '2026-10-28', crossCurrency: false })
    expect(same).toMatchObject({ type: 'transfer', toAccountId: 'a2' })
    for (const key of ['toAmount', 'categoryId', 'counterpartyId', 'accrual']) expect(key in same).toBe(false)
    expect(stateToDraft(base, { today: '2026-10-28', crossCurrency: true }).toAmount).toBe(100)
  })
})

describe('transactionToDraft', () => {
  it('reproduces a stored expense in full, so that a create or a full replace restores it', () => {
    const tx = stored({
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
      projectId: 'p1',
      tags: ['q4'],
      fileUrls: ['https://x/f.pdf'],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    expect(transactionToDraft(tx)).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      amount: 120.5,
      paymentDate: '2026-10-20',
      isRecurring: false,
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
      projectId: 'p1',
      tags: ['q4'],
      fileUrls: ['https://x/f.pdf'],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
  })

  it('leaves out an accrual that only followed the payment date, so it follows again', () => {
    expect(transactionToDraft(stored()).accrual).toBeUndefined()
  })

  it('a transfer carries its target, the second amount only across currencies, and no accrual or counterparty', () => {
    const cross = transactionToDraft(
      stored({ type: 'transfer', toAccountId: 'a2', toAmount: 28, toCurrency: 'EUR', accrual: { mode: 'date', date: '2026-10-01' } }),
    )
    expect(cross).toMatchObject({ toAccountId: 'a2', toAmount: 28 })
    expect('accrual' in cross).toBe(false)
    const same = transactionToDraft(stored({ type: 'transfer', toAccountId: 'a2', toAmount: 120.5, toCurrency: 'PLN' }))
    expect('toAmount' in same).toBe(false)
  })

  it('does not share the arrays with the stored operation', () => {
    const tx = stored({ tags: ['a'] })
    transactionToDraft(tx).tags.push('b')
    expect(tx.tags).toEqual(['a'])
  })
})
```

Імпорти нагорі файлу: `stateToDraft`, `transactionToDraft` з `@/lib/api/transaction-draft`; `FormState`, `initialFormState` з `@/lib/domain/transaction-form/state`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/api/transaction-draft.test.ts`
Expected: FAIL (`stateToDraft`/`transactionToDraft` not exported; old `buildEditDraft` semantics).

- [ ] **Step 3: Implement** — замінити вміст `lib/api/transaction-draft.ts` на:

```ts
import type { TransactionDraft } from '@/lib/api/ledger-client'
import { accrualFor } from '@/lib/domain/transaction-form/accrual'
import { effectiveStatus } from '@/lib/domain/transaction-form/status'
import type { FormState } from '@/lib/domain/transaction-form/state'
import { parseAmountInput } from '@/lib/utils/amount-input'
import type { Transaction } from '@/types'

/** What the transaction form edits itself: everything in a draft except what it has no control for (project, tags, files). */
export type FormOwnedDraft = Omit<TransactionDraft, 'projectId' | 'tags' | 'fileUrls'>

/** The `YYYY-MM-DD` UTC day of a stored payment date. */
function paymentDay(date: Date): string {
  return date.toISOString().split('T')[0]
}

/** The draft the form sends for what is typed. `validateState` has already refused anything unparseable. */
export function stateToDraft(state: FormState, o: { today: string; crossCurrency: boolean }): FormOwnedDraft {
  const draft: FormOwnedDraft = {
    type: state.type,
    status: effectiveStatus(state.status, state.paymentDate, o.today),
    accountId: state.accountId,
    amount: parseAmountInput(state.amount) ?? 0,
    paymentDate: state.paymentDate,
    isRecurring: state.isRecurring,
  }
  if (state.type === 'transfer') {
    draft.toAccountId = state.toAccountId
    if (o.crossCurrency) draft.toAmount = parseAmountInput(state.toAmount) ?? 0
  } else {
    if (state.categoryId) draft.categoryId = state.categoryId
    if (state.counterpartyId) draft.counterpartyId = state.counterpartyId
    const accrual = accrualFor(state.accrual, state.paymentDate)
    if (accrual) draft.accrual = accrual
  }
  const description = state.description.trim()
  if (description) draft.description = description
  return draft
}

/** A draft for a new operation: it has no tags, files or project yet. */
export function buildCreateDraft(form: FormOwnedDraft): TransactionDraft {
  return { ...form, tags: [], fileUrls: [] }
}

/**
 * A draft for saving an edited operation. The edit is sent as a full replace (absent optional fields are
 * cleared), so the three fields the form has no control for must be carried over from the stored operation,
 * or an edit of the amount alone would erase them: project, tags and files. Everything else (category,
 * counterparty, accrual, status, description) comes from the form, so the person can still change or clear it.
 */
export function buildEditDraft(transaction: Transaction, form: FormOwnedDraft): TransactionDraft {
  const draft: TransactionDraft = {
    ...form,
    tags: [...transaction.tags],
    fileUrls: [...transaction.fileUrls],
  }
  if (transaction.projectId !== undefined) draft.projectId = transaction.projectId
  return draft
}

/**
 * The full draft of a stored operation: what a create (restoring a deleted operation) or a full replace
 * (undoing an edit) needs to give the same operation back. An accrual that merely followed the payment date
 * is left out so it follows again. A transfer has neither accrual nor counterparty (the server refuses both),
 * and its second amount only matters across currencies.
 */
export function transactionToDraft(tx: Transaction): TransactionDraft {
  const draft: TransactionDraft = {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    amount: tx.amount,
    paymentDate: paymentDay(tx.date),
    isRecurring: tx.isRecurring,
    tags: [...tx.tags],
    fileUrls: [...tx.fileUrls],
  }
  if (tx.description !== undefined) draft.description = tx.description
  if (tx.projectId !== undefined) draft.projectId = tx.projectId
  if (tx.type === 'transfer') {
    if (tx.toAccountId !== undefined) draft.toAccountId = tx.toAccountId
    if (tx.toAmount !== undefined && tx.toCurrency !== undefined && tx.toCurrency !== tx.currency) draft.toAmount = tx.toAmount
    return draft
  }
  if (tx.categoryId !== undefined) draft.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) draft.counterpartyId = tx.counterpartyId
  const followedPaymentDate = tx.accrual.mode === 'date' && tx.accrual.date === paymentDay(tx.date)
  if (!followedPaymentDate) draft.accrual = tx.accrual
  return draft
}

/** The category after the user picks another type tab: a category belongs to one type, so it is cleared on a real change only. */
export function categoryAfterTypeChange(
  categoryId: string,
  from: Transaction['type'],
  to: Transaction['type'],
): string {
  return from === to ? categoryId : ''
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/api/transaction-draft.test.ts`
Expected: PASS. Потім `npx tsc --noEmit`: чисто (стара форма ще компілюється, бо новий `FormOwnedDraft` сумісний зі старим).

- [ ] **Step 5: Commit**

```bash
git add lib/api/transaction-draft.ts tests/unit/api/transaction-draft.test.ts
git commit -m "feat(transaction-form): state-to-draft bridge and full draft of a stored operation"
```

> Увага: до Task 10 стара форма при редагуванні не переносить контрагента й accrual (тепер це робить форма). Нічого не мерджиться раніше за Task 10, тож це лише проміжний стан гілки.

---

### Task 6: Undo-виклики API і доказ відновлення на емуляторі

Це перша перевірка з спеки: повторне створення видаленої операції з тим самим id дає той самий баланс і rollups. Серверного коду не змінюємо; якщо тест нижче впаде, зупинитися й доповісти (потрібна серверна дія `restore`, це зміна спеки).

**Files:**
- Create: `lib/api/transaction-undo.ts`, `tests/unit/api/transaction-undo.test.ts`, `tests/integration/ledger-restore.test.ts`

- [ ] **Step 1: Write the failing unit test** `tests/unit/api/transaction-undo.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreTransaction, revertTransaction } from '@/lib/api/transaction-undo'
import type { Transaction } from '@/types'

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

const stored: Transaction = {
  id: 'AbCdEfGh1234567890Zz',
  orgId: 'o1',
  accountId: 'a1',
  type: 'expense',
  status: 'actual',
  amount: 120.5,
  currency: 'PLN',
  categoryId: 'c1',
  counterpartyId: 'cp1',
  date: new Date('2026-10-20T00:00:00Z'),
  accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
  description: 'Czynsz',
  isRecurring: false,
  tags: ['q4'],
  fileUrls: [],
}

describe('restoreTransaction', () => {
  it('creates the operation again under its own id, with everything it had', async () => {
    fetchMock.mockResolvedValue(json(201, { transaction: { id: stored.id } }))
    vi.stubGlobal('fetch', fetchMock)

    await restoreTransaction('o1', stored)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/orgs/o1/transactions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      clientId: stored.id,
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      amountMinor: 12050,
      paymentDate: '2026-10-20',
      isRecurring: false,
      tags: ['q4'],
      fileUrls: [],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
    })
  })
})

describe('revertTransaction', () => {
  it('writes the stored operation back as a full replace', async () => {
    fetchMock.mockResolvedValue(json(200, { transaction: { id: stored.id } }))
    vi.stubGlobal('fetch', fetchMock)

    await revertTransaction('o1', stored)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/orgs/o1/transactions/${stored.id}`)
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ amountMinor: 12050, categoryId: 'c1', counterpartyId: 'cp1', description: 'Czynsz' })
    // absent optional fields are sent as null so the replace clears them
    expect(body.projectId).toBeNull()
  })

  it('fails with the API error when the server refuses', async () => {
    fetchMock.mockResolvedValue(json(422, { error: 'counterparty_archived', field: 'counterpartyId' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(revertTransaction('o1', stored)).rejects.toMatchObject({ status: 422, code: 'counterparty_archived' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/api/transaction-undo.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/api/transaction-undo.ts`

```ts
import { createTransaction, updateTransaction } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import type { Transaction } from '@/types'

/** Undo of a delete: the operation is created again under its own id, with the content it had. */
export function restoreTransaction(orgId: string, tx: Transaction): Promise<string> {
  return createTransaction(orgId, transactionToDraft(tx), tx.id)
}

/** Undo of an edit: the operation as it was stored before the edit is written back as a full replace. */
export function revertTransaction(orgId: string, before: Transaction): Promise<void> {
  return updateTransaction(orgId, before.id, transactionToDraft(before))
}
```

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run tests/unit/api/transaction-undo.test.ts`
Expected: PASS. (Якщо очікуваний `body.projectId` не `null`, подивитися `fullPatch` у `lib/domain/ledger/input.ts` і підлаштувати перевірку під те, як саме він очищає відсутні поля; суть: PATCH є повною заміною.)

- [ ] **Step 5: Write the integration test** `tests/integration/ledger-restore.test.ts`

Використовує ті самі хелпери, що `ledger-transactions.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { draftToBody, draftToPatch } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import type { Transaction } from '@/types'
import {
  ORG,
  UID,
  balanceOf,
  clearFirestore,
  makeDeps,
  readDoc,
  seedAccount,
  seedCategory,
  seedCounterparty,
  seedOrg,
  testDb,
} from './helpers'

const db = testDb()
const deps = makeDeps(db)

/** The wire the browser uses: a draft becomes a JSON body that the server parses as a create or a full replace. */
const asCreate = (tx: Transaction) => parseTransactionInput(JSON.parse(JSON.stringify(draftToBody(transactionToDraft(tx), tx.id))))
const asReplace = (tx: Transaction) => parseTransactionPatch(JSON.parse(JSON.stringify(draftToPatch(transactionToDraft(tx)))))

/** Rollup documents as stored, without leaves that hold 0: an edit that moves an amount away from a bucket leaves that bucket at 0, which says the same as no bucket. */
function withoutZeros(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const entries = Object.entries(value).flatMap(([key, child]): [string, unknown][] => {
    const pruned = withoutZeros(child)
    if (pruned === 0) return []
    if (typeof pruned === 'object' && pruned !== null && Object.keys(pruned).length === 0) return []
    return [[key, pruned]]
  })
  return Object.fromEntries(entries)
}

async function rollups(): Promise<Record<string, unknown>> {
  const snap = await db.collection(`organizations/${ORG}/rollups`).get()
  return withoutZeros(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))) as Record<string, unknown>
}

const VOLATILE = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy']

/** The stored operation without the fields that legitimately change on a rewrite. */
async function stored(id: string): Promise<Record<string, unknown>> {
  const doc = (await readDoc(db, `organizations/${ORG}/transactions/${id}`)) ?? {}
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !VOLATILE.includes(key)))
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedCategory(db, ORG, 'c1', 'expense')
  await seedCounterparty(db, ORG, 'cp1')
  await seedAccount(db, ORG, 'a1', 'PLN', 5000)
  await seedAccount(db, ORG, 'a2', 'EUR', 1000)
})

async function create(extra: Record<string, unknown>): Promise<Transaction> {
  const { transaction } = await createTransaction(
    deps,
    ORG,
    UID,
    parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 12050, paymentDate: '2026-10-20', ...extra }),
  )
  return toUiTransaction(ORG, transaction)
}

describe('undo of a delete (create again under the same id)', () => {
  it('gives back the same balance, rollups and operation, and the ledger still verifies', async () => {
    const tx = await create({
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    const balanceBefore = await balanceOf(db, ORG, 'a1')
    const rollupsBefore = await rollups()
    const docBefore = await stored(tx.id)

    await deleteTransaction(deps, ORG, UID, tx.id)
    expect(await balanceOf(db, ORG, 'a1')).toBe(5000)

    await createTransaction(deps, ORG, UID, asCreate(tx))

    expect(await balanceOf(db, ORG, 'a1')).toBe(balanceBefore)
    expect(await rollups()).toEqual(rollupsBefore)
    expect(await stored(tx.id)).toEqual(docBefore)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true, balanceDiffs: [], rollupDiffs: [] })
  })

  it('restores an operation in a foreign currency with the same converted amounts', async () => {
    const tx = await create({ accountId: 'a2', amountMinor: 10000, paymentDate: '2026-10-20' })
    const rollupsBefore = await rollups()
    const docBefore = await stored(tx.id)

    await deleteTransaction(deps, ORG, UID, tx.id)
    await createTransaction(deps, ORG, UID, asCreate(tx))

    expect(await rollups()).toEqual(rollupsBefore)
    expect(await stored(tx.id)).toEqual(docBefore)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true })
  })

  it('restores a planned operation, which never touched the balance', async () => {
    const tx = await create({ status: 'planned', paymentDate: '2026-12-01' })
    await deleteTransaction(deps, ORG, UID, tx.id)
    await createTransaction(deps, ORG, UID, asCreate(tx))
    expect(await balanceOf(db, ORG, 'a1')).toBe(5000)
    expect(await stored(tx.id)).toMatchObject({ status: 'planned', paymentDate: '2026-12-01' })
  })

  it('a restore of a transfer returns both balances', async () => {
    const { transaction } = await createTransaction(
      deps,
      ORG,
      UID,
      parseTransactionInput({ type: 'transfer', accountId: 'a1', toAccountId: 'a2', amountMinor: 44000, toAmountMinor: 10000, paymentDate: '2026-10-20' }),
    )
    const tx = toUiTransaction(ORG, transaction)
    const balances = [await balanceOf(db, ORG, 'a1'), await balanceOf(db, ORG, 'a2')]
    await deleteTransaction(deps, ORG, UID, tx.id)
    await createTransaction(deps, ORG, UID, asCreate(tx))
    expect([await balanceOf(db, ORG, 'a1'), await balanceOf(db, ORG, 'a2')]).toEqual(balances)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true })
  })
})

describe('undo of an edit (full replace with the earlier operation)', () => {
  it('brings back the amount, the counterparty, the accrual, the balance and the rollups', async () => {
    const tx = await create({
      categoryId: 'c1',
      counterpartyId: 'cp1',
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    const balanceBefore = await balanceOf(db, ORG, 'a1')
    const rollupsBefore = await rollups()
    const docBefore = await stored(tx.id)

    // The edit: another amount, no counterparty, the accrual back on the payment date.
    await updateTransaction(
      deps,
      ORG,
      UID,
      tx.id,
      parseTransactionPatch({ amountMinor: 5000, counterpartyId: null, accrual: null, categoryId: null }),
    )
    expect(await balanceOf(db, ORG, 'a1')).not.toBe(balanceBefore)

    await updateTransaction(deps, ORG, UID, tx.id, asReplace(tx))

    expect(await balanceOf(db, ORG, 'a1')).toBe(balanceBefore)
    expect(await rollups()).toEqual(rollupsBefore)
    expect(await stored(tx.id)).toEqual(docBefore)
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true })
  })
})
```

- [ ] **Step 6: Run the integration test**

Run: `npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-restore.test.ts"`
Expected: PASS. Якщо падає, не «підганяти» тест: з'ясувати причину (різниця в полі `stored`, у rollups). Різниця лише в службових полях типу `migratedFrom` не очікується. Реальна розбіжність балансу/rollups означає, що потрібна серверна `restore`: **зупинитися й доповісти**.

- [ ] **Step 7: Commit**

```bash
git add lib/api/transaction-undo.ts tests/unit/api/transaction-undo.test.ts tests/integration/ledger-restore.test.ts
git commit -m "feat(transaction-form): undo calls for delete and edit, proven on the emulator"
```

---

### Task 7: Підказка курсу (`rates-client.ts`, `useRatePreview`)

**Files:**
- Create: `lib/api/rates-client.ts`, `tests/unit/api/rates-client.test.ts`, `lib/hooks/useRatePreview.ts`

- [ ] **Step 1: Write the failing test** `tests/unit/api/rates-client.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRate } from '@/lib/api/rates-client'

const fetchMock = vi.fn()

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchRate', () => {
  it('asks /api/rates with from, to and date and returns the rate and the table day', async () => {
    fetchMock.mockResolvedValue(json(200, { rate: 4.25, rateDate: '2026-10-27', from: 'EUR', to: 'PLN' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toEqual({ rate: 4.25, rateDate: '2026-10-27' })

    const [url] = fetchMock.mock.calls[0] as [string]
    const params = new URL(url, 'http://x').searchParams
    expect(url.startsWith('/api/rates?')).toBe(true)
    expect([...params.keys()].sort()).toEqual(['date', 'from', 'to'])
    expect(params.get('from')).toBe('EUR')
    expect(params.get('to')).toBe('PLN')
    expect(params.get('date')).toBe('2026-10-28')
  })

  it('is null when the server answers with an error status', async () => {
    fetchMock.mockResolvedValue(json(503, { error: 'provider_unavailable' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toBeNull()
  })

  it('is null for a body that is not a usable rate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { rate: 0, rateDate: '2026-10-27' })))
    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { rate: 4.2 })))
    await expect(fetchRate('EUR', 'PLN', '2026-10-28')).resolves.toBeNull()
  })

  it('lets an abort through, so a caller can tell it from a failed call', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRate('EUR', 'PLN', '2026-10-28', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/api/rates-client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/api/rates-client.ts`

```ts
export interface RateInfo {
  rate: number
  /** The day of the NBP table the rate comes from. */
  rateDate: string
}

/** The NBP rate for a hint in the form. Null when the server has none (an error status or an unusable body). */
export async function fetchRate(from: string, to: string, date: string, signal?: AbortSignal): Promise<RateInfo | null> {
  const query = new URLSearchParams({ from, to, date })
  const res = await fetch(`/api/rates?${query.toString()}`, { credentials: 'same-origin', signal })
  if (!res.ok) return null
  const body = (await res.json()) as { rate?: unknown; rateDate?: unknown }
  if (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate <= 0) return null
  if (typeof body.rateDate !== 'string') return null
  return { rate: body.rate, rateDate: body.rateDate }
}
```

- [ ] **Step 4: Implement the hook** `lib/hooks/useRatePreview.ts` (без окремого unit-тесту: у `tests/unit` немає DOM; поведінку покриває e2e у Task 12)

```ts
'use client'

import { useEffect, useState } from 'react'
import { fetchRate, type RateInfo } from '@/lib/api/rates-client'
import { isDay } from '@/lib/domain/ledger/days'

export type RatePreview =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; rate: number; rateDate: string }
  | { state: 'unavailable' }

const IDLE: RatePreview = { state: 'idle' }
const LOADING: RatePreview = { state: 'loading' }
const UNAVAILABLE: RatePreview = { state: 'unavailable' }
const DEBOUNCE_MS = 300

/**
 * The NBP rate to show next to an amount, only a hint (the server stores the real conversion). `from` is null
 * when no conversion is needed. A change of currency or date asks again after a short pause; an answer that
 * arrives for an earlier question is dropped. A failed or unavailable rate never blocks saving.
 */
export function useRatePreview(from: string | null, to: string, date: string): RatePreview {
  const enabled = from !== null && from !== to && isDay(date)
  const key = `${from}>${to}@${date}`
  const [result, setResult] = useState<{ key: string; info: RateInfo | null } | null>(null)

  useEffect(() => {
    if (!enabled || from === null) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchRate(from, to, date, controller.signal)
        .then((info) => setResult({ key, info }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ key, info: null })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, from, to, date, key])

  if (!enabled) return IDLE
  if (result?.key !== key) return LOADING
  return result.info ? { state: 'ok', rate: result.info.rate, rateDate: result.info.rateDate } : UNAVAILABLE
}
```

- [ ] **Step 5: Run and commit**

Run: `npx vitest run tests/unit/api/rates-client.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, tsc clean, lint без нових попереджень (особливо `react-hooks/*`).

```bash
git add lib/api/rates-client.ts lib/hooks/useRatePreview.ts tests/unit/api/rates-client.test.ts
git commit -m "feat(transaction-form): NBP rate hint client and hook"
```

---

### Task 8: Тост undo, сегментований перемикач, діалог підтвердження

**Files:**
- Create: `lib/ui/undo-toast.ts`, `tests/unit/ui/undo-toast.test.ts`, `components/ui/segmented.tsx`, `components/forms/transaction/ConfirmDialog.tsx`

- [ ] **Step 1: Write the failing test** `tests/unit/ui/undo-toast.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => {
  const toast = vi.fn() as ReturnType<typeof vi.fn> & { error: ReturnType<typeof vi.fn> }
  toast.error = vi.fn()
  return toast
})
vi.mock('sonner', () => ({ toast: toastMock }))

import { UNDO_MS, undoToast } from '@/lib/ui/undo-toast'

beforeEach(() => {
  toastMock.mockReset()
  toastMock.error.mockReset()
})

type Options = { duration: number; action: { label: string; onClick: () => void } }
const shown = (): Options => toastMock.mock.calls[0][1] as Options
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('undoToast', () => {
  it('shows the message for about ten seconds with the action label', () => {
    undoToast({ message: 'Deleted', actionLabel: 'Undo', failureMessage: 'Failed', undo: async () => undefined })
    expect(toastMock.mock.calls[0][0]).toBe('Deleted')
    expect(shown().duration).toBe(UNDO_MS)
    expect(shown().action.label).toBe('Undo')
  })

  it('runs the undo on click and stays quiet when it works', async () => {
    const undo = vi.fn().mockResolvedValue(undefined)
    undoToast({ message: 'Deleted', actionLabel: 'Undo', failureMessage: 'Failed', undo })
    shown().action.onClick()
    await flush()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('tells the person when the undo is refused', async () => {
    undoToast({ message: 'Deleted', actionLabel: 'Undo', failureMessage: 'Failed', undo: () => Promise.reject(new Error('409')) })
    shown().action.onClick()
    await flush()
    expect(toastMock.error).toHaveBeenCalledWith('Failed')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/ui/undo-toast.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/ui/undo-toast.ts`

```ts
import { toast } from 'sonner'

export const UNDO_MS = 10_000

export interface UndoToast {
  message: string
  actionLabel: string
  failureMessage: string
  /** Reverses what the toast announces. It runs after the form that raised it is gone, so it must not touch component state. */
  undo: () => Promise<unknown>
}

export function undoToast({ message, actionLabel, failureMessage, undo }: UndoToast): void {
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: actionLabel,
      onClick: () => {
        void undo().catch(() => {
          toast.error(failureMessage)
        })
      },
    },
  })
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/ui/undo-toast.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `components/ui/segmented.tsx`**

```tsx
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
```

- [ ] **Step 6: Add `components/forms/transaction/ConfirmDialog.tsx`**

Перед написанням переконатися, що в `components/ui/dialog.tsx` експортуються `DialogDescription` і що `Button` має варіант `destructive` (так, обидва є).

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A yes/no question over the form: closing it (Esc, the cross) answers «no». */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, destructive, busy, onConfirm, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 7: Check and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean, без нових попереджень.

```bash
git add lib/ui/undo-toast.ts tests/unit/ui/undo-toast.test.ts components/ui/segmented.tsx components/forms/transaction/ConfirmDialog.tsx
git commit -m "feat(transaction-form): undo toast, segmented control and confirm dialog"
```

---

### Task 9: Переклади (pl, en, uk)

**Files:**
- Modify: `messages/uk.json`, `messages/pl.json`, `messages/en.json`

У кожному файлі в об'єкті `forms.transaction`: значення ключа `date` змінюється на «Дата платежу» (uk) / «Data płatności» (pl) / «Payment date» (en); додаються ключі нижче (разом із нових підключів у `errors`). Існуючі ключі не чіпати. Порядок і форматування JSON як у файлі (2 пробіли).

- [ ] **Step 1: Add the keys**

`messages/uk.json`, у `forms.transaction`:

```json
"date": "Дата платежу",
"status": "Статус",
"statusActual": "Факт",
"statusPlanned": "План",
"statusFutureHint": "Платіж у майбутньому записується як плановий",
"markPaid": "Позначити сплаченою",
"accrualSwitch": "Дата транзакції інша",
"accrualMode": "Тип дати транзакції",
"accrualModeDate": "Дата",
"accrualModePeriod": "Період",
"accrualDate": "Дата транзакції",
"accrualFrom": "Період з",
"accrualTo": "Період до",
"accrualHint": "Операція враховується в P&L у вказаному періоді",
"counterparty": "Контрагент",
"rateHint": "≈ {amount} за курсом НБП на {date}",
"rateUnavailable": "Курс НБП зараз недоступний",
"rateLine": "Курс: 1 {base} = {value} {quote}",
"delete": "Видалити",
"deleteTitle": "Видалити операцію?",
"deleteBody": "Операцію буде видалено, баланс рахунку зміниться. Одразу після видалення її можна повернути кнопкою «Скасувати».",
"deleteConfirm": "Видалити",
"deleted": "Операцію видалено",
"saved": "Зміни збережено",
"undo": "Скасувати",
"undoFailed": "Не вдалося скасувати. Дані не змінено.",
"discardTitle": "Закрити без збереження?",
"discardBody": "Введені дані не збережуться.",
"discardConfirm": "Закрити",
"discardStay": "Залишитись"
```

і в `forms.transaction.errors`:

```json
"paymentDate": "Вкажіть дату платежу",
"accrualDate": "Вкажіть дату транзакції",
"accrualFrom": "Вкажіть початок періоду",
"accrualTo": "Вкажіть кінець періоду",
"accrualOrder": "Початок періоду має бути не пізніше за його кінець",
"counterpartyArchived": "Контрагент в архіві. Оберіть іншого",
"counterpartyMissing": "Контрагента не знайдено",
"delete": "Не вдалося видалити операцію. Спробуйте ще раз."
```

`messages/pl.json`, у `forms.transaction`:

```json
"date": "Data płatności",
"status": "Status",
"statusActual": "Faktyczna",
"statusPlanned": "Planowana",
"statusFutureHint": "Płatność w przyszłości jest zapisywana jako planowana",
"markPaid": "Oznacz jako zapłaconą",
"accrualSwitch": "Data transakcji jest inna",
"accrualMode": "Rodzaj daty transakcji",
"accrualModeDate": "Data",
"accrualModePeriod": "Okres",
"accrualDate": "Data transakcji",
"accrualFrom": "Okres od",
"accrualTo": "Okres do",
"accrualHint": "Operacja będzie liczona w P&L w podanym okresie",
"counterparty": "Kontrahent",
"rateHint": "≈ {amount} według kursu NBP z {date}",
"rateUnavailable": "Kurs NBP jest teraz niedostępny",
"rateLine": "Kurs: 1 {base} = {value} {quote}",
"delete": "Usuń",
"deleteTitle": "Usunąć operację?",
"deleteBody": "Operacja zostanie usunięta, a saldo konta się zmieni. Zaraz po usunięciu możesz ją przywrócić przyciskiem „Cofnij”.",
"deleteConfirm": "Usuń",
"deleted": "Operację usunięto",
"saved": "Zmiany zapisano",
"undo": "Cofnij",
"undoFailed": "Nie udało się cofnąć. Dane nie zostały zmienione.",
"discardTitle": "Zamknąć bez zapisywania?",
"discardBody": "Wprowadzone dane nie zostaną zapisane.",
"discardConfirm": "Zamknij",
"discardStay": "Zostań"
```

`errors`:

```json
"paymentDate": "Podaj datę płatności",
"accrualDate": "Podaj datę transakcji",
"accrualFrom": "Podaj początek okresu",
"accrualTo": "Podaj koniec okresu",
"accrualOrder": "Początek okresu nie może być późniejszy niż jego koniec",
"counterpartyArchived": "Kontrahent jest w archiwum. Wybierz innego",
"counterpartyMissing": "Nie znaleziono kontrahenta",
"delete": "Nie udało się usunąć operacji. Spróbuj ponownie."
```

`messages/en.json`, у `forms.transaction`:

```json
"date": "Payment date",
"status": "Status",
"statusActual": "Actual",
"statusPlanned": "Planned",
"statusFutureHint": "A payment in the future is saved as planned",
"markPaid": "Mark as paid",
"accrualSwitch": "Transaction date is different",
"accrualMode": "Transaction date type",
"accrualModeDate": "Date",
"accrualModePeriod": "Period",
"accrualDate": "Transaction date",
"accrualFrom": "Period from",
"accrualTo": "Period to",
"accrualHint": "The operation is counted in the P&L in the period given here",
"counterparty": "Counterparty",
"rateHint": "≈ {amount} at the NBP rate of {date}",
"rateUnavailable": "The NBP rate is unavailable right now",
"rateLine": "Rate: 1 {base} = {value} {quote}",
"delete": "Delete",
"deleteTitle": "Delete the transaction?",
"deleteBody": "The transaction will be deleted and the account balance will change. Right after deleting you can bring it back with “Undo”.",
"deleteConfirm": "Delete",
"deleted": "Transaction deleted",
"saved": "Changes saved",
"undo": "Undo",
"undoFailed": "Could not undo. Nothing was changed.",
"discardTitle": "Close without saving?",
"discardBody": "What you entered will not be saved.",
"discardConfirm": "Close",
"discardStay": "Keep editing"
```

`errors`:

```json
"paymentDate": "Enter the payment date",
"accrualDate": "Enter the transaction date",
"accrualFrom": "Enter the start of the period",
"accrualTo": "Enter the end of the period",
"accrualOrder": "The period cannot end before it starts",
"counterpartyArchived": "The counterparty is archived. Choose another one",
"counterpartyMissing": "The counterparty was not found",
"delete": "Could not delete the transaction. Try again."
```

- [ ] **Step 2: Verify**

Run: `node -e "for (const l of ['uk','pl','en']) JSON.parse(require('fs').readFileSync('messages/'+l+'.json','utf8'))" && npx vitest run tests/unit/i18n`
Expected: JSON парситься, i18n-тести (паритет ключів між мовами) проходять. Якщо тест паритету називається інакше, запустити `npx vitest run -t i18n` або весь `npm run test:unit`.

- [ ] **Step 3: Commit**

```bash
git add messages/uk.json messages/pl.json messages/en.json
git commit -m "feat(transaction-form): translations for status, dates, undo and guards"
```

---

### Task 10: Форма операції (секції й головний компонент)

Нова форма живе в `components/forms/transaction/`. Файл `components/forms/TransactionForm.tsx` стає реекспортом, щоб `lazy.tsx` і імпортери не змінювались. Старий код форми видаляється повністю.

Правила, які зберігаються (їх спираються наявні e2e): порядок native `<select>` у панелі: рахунок, [рахунок «куди» для переказу], категорія (для доходу/витрати); поле суми має мітку «Сума», опис «Опис», кнопка створення «Додати» (uk); панель має роль `tabpanel`; у ній немає елементів з `data-slot="select-trigger"`; валюта виводиться текстом у панелі.

**Files:**
- Create: `components/forms/transaction/{StatusField,AmountFields,DatesFields,CounterpartyField,TransactionForm}.tsx`
- Modify: `components/forms/TransactionForm.tsx` (повністю замінити)

- [ ] **Step 1: `StatusField.tsx`**

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import type { TxStatus } from '@/lib/domain/ledger/types'

interface Props {
  /** The status that will be saved (a future payment date already forces `planned`). */
  status: TxStatus
  /** The payment date is in the future: «Факт» is not allowed. */
  locked: boolean
  onChange: (status: TxStatus) => void
}

export function StatusField({ status, locked, onChange }: Props) {
  const t = useTranslations('forms.transaction')
  return (
    <div className="space-y-1">
      <Label>{t('status')}</Label>
      <Segmented
        label={t('status')}
        value={status}
        onChange={onChange}
        options={[
          { value: 'actual', label: t('statusActual'), disabled: locked },
          { value: 'planned', label: t('statusPlanned') },
        ]}
      />
      {locked && <p className="text-xs text-ink-muted">{t('statusFutureHint')}</p>}
    </div>
  )
}
```

- [ ] **Step 2: `AmountFields.tsx`** (рахунки, суми, підказка курсу)

```tsx
'use client'

import type { Ref } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { TxStatus, TxType } from '@/lib/domain/ledger/types'
import { convertApprox, rateLine } from '@/lib/domain/transaction-form/rate'
import type { FormErrors, FormState } from '@/lib/domain/transaction-form/state'
import { useRatePreview } from '@/lib/hooks/useRatePreview'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { parseAmountInput } from '@/lib/utils/amount-input'
import type { Account } from '@/types'

const AMOUNT_COLOR: Record<TxType, string> = { income: 'text-income', expense: 'text-expense', transfer: 'text-ink' }

const READONLY_BOX = 'flex h-9 w-full items-center rounded-control border border-input bg-surface px-3 text-sm'

interface Props {
  state: FormState
  /** The status that will be saved; a planned operation has no conversion, so no rate hint. */
  status: TxStatus
  accounts: Account[]
  /** The company currency: what a foreign amount is converted to in the hint. */
  baseCurrency: string
  /** The currency of the chosen account. */
  currency: string
  /** The currency of the target account, only when a transfer crosses currencies. */
  toCurrency: string | null
  errors: FormErrors
  amountRef: Ref<HTMLInputElement>
  onChange: (patch: Partial<FormState>) => void
}

export function AmountFields({ state, status, accounts, baseCurrency, currency, toCurrency, errors, amountRef, onChange }: Props) {
  const t = useTranslations('forms.transaction')
  const { money, number } = useFormatters()
  const isTransfer = state.type === 'transfer'
  const typedAmount = parseAmountInput(state.amount)

  const needsRate = !isTransfer && status === 'actual' && currency !== baseCurrency
  const preview = useRatePreview(needsRate ? currency : null, baseCurrency, state.paymentDate)
  const line = toCurrency === null ? null : rateLine(typedAmount ?? 0, currency, parseAmountInput(state.toAmount) ?? 0, toCurrency)

  const color = AMOUNT_COLOR[state.type]
  const error = (key: keyof FormErrors) => {
    const message = errors[key]
    return message ? <p className="text-xs text-expense">{t(`errors.${message}`)}</p> : null
  }

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="tx-account">{isTransfer ? t('accountFrom') : t('account')}</Label>
        <NativeSelect
          id="tx-account"
          wrapperClassName="w-full"
          value={state.accountId}
          onChange={(e) => onChange({ accountId: e.target.value })}
        >
          <option value="">{t('chooseAccount')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        {error('accountId')}
      </div>

      {isTransfer && (
        <div className="space-y-1">
          <Label htmlFor="tx-account-to">{t('accountTo')}</Label>
          <NativeSelect
            id="tx-account-to"
            wrapperClassName="w-full"
            value={state.toAccountId}
            onChange={(e) => onChange({ toAccountId: e.target.value })}
          >
            <option value="">{t('chooseAccount')}</option>
            {accounts
              .filter((a) => a.id !== state.accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </NativeSelect>
          {error('toAccountId')}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="tx-amount">{t('amount')}</Label>
          {/* Text, not number: a number field rejects `1 234,50` and depends on the browser's locale. */}
          <Input
            id="tx-amount"
            ref={amountRef}
            type="text"
            inputMode="decimal"
            value={state.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            className={cn('text-lg font-semibold tabular-nums', color)}
          />
          {error('amount')}
        </div>
        <div className="space-y-1">
          <Label>{t('currency')}</Label>
          <div className={READONLY_BOX}>{currency}</div>
        </div>
      </div>

      {preview.state === 'ok' && typedAmount !== null && typedAmount > 0 && (
        <p className="text-xs tabular-nums text-ink-muted">
          {t('rateHint', { amount: money(convertApprox(typedAmount, preview.rate), baseCurrency), date: preview.rateDate })}
        </p>
      )}
      {preview.state === 'unavailable' && <p className="text-xs text-ink-muted">{t('rateUnavailable')}</p>}

      {isTransfer && toCurrency !== null && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="tx-amount-to">{t('amountTo')}</Label>
              <Input
                id="tx-amount-to"
                type="text"
                inputMode="decimal"
                value={state.toAmount}
                onChange={(e) => onChange({ toAmount: e.target.value })}
                className={cn('text-lg font-semibold tabular-nums', color)}
              />
              {error('toAmount')}
            </div>
            <div className="space-y-1">
              <Label>{t('currency')}</Label>
              <div className={READONLY_BOX}>{toCurrency}</div>
            </div>
          </div>
          {line && (
            <p className="text-xs tabular-nums text-ink-muted">
              {t('rateLine', { base: line.base, value: number(line.value, { minimumFractionDigits: 4, maximumFractionDigits: 6 }), quote: line.quote })}
            </p>
          )}
        </>
      )}
    </>
  )
}
```

- [ ] **Step 3: `DatesFields.tsx`** (дата платежу, дата транзакції / період)

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import type { AccrualState } from '@/lib/domain/transaction-form/accrual'
import type { FormErrors, FormState } from '@/lib/domain/transaction-form/state'

interface Props {
  paymentDate: string
  accrual: AccrualState
  /** False for a transfer: it has no accrual. */
  showAccrual: boolean
  errors: FormErrors
  onChange: (patch: Partial<FormState>) => void
}

export function DatesFields({ paymentDate, accrual, showAccrual, errors, onChange }: Props) {
  const t = useTranslations('forms.transaction')
  const setAccrual = (patch: Partial<AccrualState>) => onChange({ accrual: { ...accrual, ...patch } })

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="tx-date">{t('date')}</Label>
        <Input id="tx-date" type="date" value={paymentDate} onChange={(e) => onChange({ paymentDate: e.target.value })} />
        {errors.paymentDate && <p className="text-xs text-expense">{t(`errors.${errors.paymentDate}`)}</p>}
      </div>

      {showAccrual && (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={accrual.on}
              onChange={(e) => setAccrual({ on: e.target.checked })}
              className="accent-brand"
            />
            <span>{t('accrualSwitch')}</span>
          </label>

          {accrual.on && (
            <div className="space-y-3 rounded-control bg-muted p-3">
              <Segmented
                label={t('accrualMode')}
                value={accrual.mode}
                onChange={(mode) => setAccrual({ mode })}
                options={[
                  { value: 'date', label: t('accrualModeDate') },
                  { value: 'period', label: t('accrualModePeriod') },
                ]}
              />
              {accrual.mode === 'date' ? (
                <div className="space-y-1">
                  <Label htmlFor="tx-accrual-date">{t('accrualDate')}</Label>
                  <Input
                    id="tx-accrual-date"
                    type="date"
                    value={accrual.date ?? paymentDate}
                    onChange={(e) => setAccrual({ date: e.target.value })}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="tx-accrual-from">{t('accrualFrom')}</Label>
                    <Input
                      id="tx-accrual-from"
                      type="date"
                      value={accrual.from}
                      onChange={(e) => setAccrual({ from: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tx-accrual-to">{t('accrualTo')}</Label>
                    <Input
                      id="tx-accrual-to"
                      type="date"
                      value={accrual.to}
                      onChange={(e) => setAccrual({ to: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-ink-muted">{t('accrualHint')}</p>
              {errors.accrual && <p className="text-xs text-expense">{t(`errors.${errors.accrual}`)}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: `CounterpartyField.tsx`** (вибір контрагента й створення «на льоту»)

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CounterpartyForm } from '@/components/counterparties/CounterpartyForm'
import { CounterpartyPicker } from '@/components/counterparties/CounterpartyPicker'
import { Label } from '@/components/ui/label'
import { useCounterparties } from '@/lib/hooks/useCounterparties'

interface Props {
  orgId: string
  /** The chosen counterparty id, or '' for none. */
  value: string
  onChange: (id: string) => void
  error?: string
}

export function CounterpartyField({ orgId, value, onChange, error }: Props) {
  const t = useTranslations('forms.transaction')
  const { counterparties } = useCounterparties(orgId)
  // What was typed in the picker when «add» was chosen; the form opens with it. Null: the form is closed.
  const [creating, setCreating] = useState<string | null>(null)
  const typedNip = creating !== null && /^\d{10}$/.test(creating.replace(/[\s-]/g, '')) ? creating.replace(/[\s-]/g, '') : undefined

  return (
    <div className="space-y-1">
      <Label htmlFor="tx-counterparty">{t('counterparty')}</Label>
      <CounterpartyPicker
        id="tx-counterparty"
        counterparties={counterparties}
        value={value || null}
        onChange={(id) => onChange(id ?? '')}
        onCreate={(typed) => setCreating(typed)}
      />
      {error && <p className="text-xs text-expense">{error}</p>}
      {creating !== null && (
        <CounterpartyForm
          orgId={orgId}
          initial={typedNip ? { nip: typedNip } : { name: creating }}
          onSaved={(saved) => onChange(saved.id)}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: `TransactionForm.tsx` (головний компонент)** — створити `components/forms/transaction/TransactionForm.tsx`

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { AmountFields } from '@/components/forms/transaction/AmountFields'
import { ConfirmDialog } from '@/components/forms/transaction/ConfirmDialog'
import { CounterpartyField } from '@/components/forms/transaction/CounterpartyField'
import { DatesFields } from '@/components/forms/transaction/DatesFields'
import { StatusField } from '@/components/forms/transaction/StatusField'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LedgerApiError, createTransaction, deleteTransaction, updateTransaction } from '@/lib/api/ledger-client'
import { buildCreateDraft, buildEditDraft, categoryAfterTypeChange, stateToDraft } from '@/lib/api/transaction-draft'
import { restoreTransaction, revertTransaction } from '@/lib/api/transaction-undo'
import type { TxType } from '@/lib/domain/ledger/types'
import { effectiveStatus, isFutureDay, paidDay } from '@/lib/domain/transaction-form/status'
import { initialFormState, isDirty, validateState, type FormErrors, type FormState } from '@/lib/domain/transaction-form/state'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { undoToast } from '@/lib/ui/undo-toast'
import { cn } from '@/lib/utils'
import { formatAmountInput } from '@/lib/utils/amount-input'
import { todayDay } from '@/lib/utils/today'
import type { Account, Category, Transaction } from '@/types'

/** Used when neither the account nor the company says which currency to preselect. */
const FALLBACK_CURRENCY = 'PLN'

interface TransactionFormProps {
  orgId: string
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  transaction?: Transaction
  defaultType?: Transaction['type']
  /** The company currency: preselected when the chosen account has none to offer, and what foreign amounts are converted to. */
  defaultCurrency?: string
  open: boolean
  onClose: () => void
}

export function TransactionForm({
  orgId,
  accounts,
  incomeCategories,
  expenseCategories,
  transaction,
  defaultType = 'income',
  defaultCurrency,
  open,
  onClose,
}: TransactionFormProps) {
  const t = useTranslations('forms.transaction')
  const tForms = useTranslations('forms')
  const tCommon = useTranslations('common')
  const { locale, money } = useFormatters()
  const categoryName = useCategoryName()
  const isEdit = !!transaction
  const today = todayDay()

  // What the form is compared with to know whether anything was typed: the stored operation, or an empty form.
  const [baseline, setBaseline] = useState<FormState>(() =>
    initialFormState({
      transaction,
      defaultType,
      defaultAccountId: accounts[0]?.id ?? '',
      today,
      formatAmount: (amount) => formatAmountInput(amount, locale),
    }),
  )
  const [state, setState] = useState<FormState>(baseline)
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  // One id per operation being created: a retry or a double click creates it once on the server.
  const clientIdRef = useRef(crypto.randomUUID())

  const patch = (changes: Partial<FormState>) => setState((s) => ({ ...s, ...changes }))

  const account = accounts.find((a) => a.id === state.accountId)
  const toAccount = accounts.find((a) => a.id === state.toAccountId)
  const baseCurrency = defaultCurrency ?? FALLBACK_CURRENCY
  // The operation is always in the currency of its account.
  const currency = account?.currency ?? baseCurrency
  const crossCurrency = state.type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency
  const status = effectiveStatus(state.status, state.paymentDate, today)
  const futureDate = isFutureDay(state.paymentDate, today)
  const dirty = isDirty(baseline, state)

  const categories = state.type === 'income' ? incomeCategories : expenseCategories
  const categoryLabel = (category: Category): string => {
    const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : undefined
    return parent ? `${categoryName(parent)} › ${categoryName(category)}` : categoryName(category)
  }

  // Focus the amount when the form opens.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => amountRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [open])

  // A category belongs to one type: it is cleared when the user picks another tab, never on mount.
  const changeType = (next: TxType) =>
    setState((s) => ({ ...s, categoryId: categoryAfterTypeChange(s.categoryId, s.type, next), type: next }))

  const saveErrorMessage = (e: unknown): string => {
    if (e instanceof LedgerApiError) {
      if (e.code === 'counterparty_archived') return t('errors.counterpartyArchived')
      if (e.code === 'counterparty_not_found') return t('errors.counterpartyMissing')
    }
    return t('errors.save')
  }

  const submit = async (addSimilar = false) => {
    const found = validateState(state, { crossCurrency })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (transaction && !dirty) {
      onClose()
      return
    }
    setBusy('save')
    try {
      const form = stateToDraft(state, { today, crossCurrency })
      if (transaction) {
        await updateTransaction(orgId, transaction.id, buildEditDraft(transaction, form))
        undoToast({
          message: t('saved'),
          actionLabel: t('undo'),
          failureMessage: t('undoFailed'),
          undo: () => revertTransaction(orgId, transaction),
        })
      } else {
        await createTransaction(orgId, buildCreateDraft(form), clientIdRef.current)
        clientIdRef.current = crypto.randomUUID()
      }
      if (addSimilar) {
        const next = { ...state, amount: '', toAmount: '', description: '' }
        setState(next)
        setBaseline(next)
        amountRef.current?.focus()
      } else {
        onClose()
      }
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!transaction) return
    setBusy('delete')
    try {
      await deleteTransaction(orgId, transaction.id)
      undoToast({
        message: t('deleted'),
        actionLabel: t('undo'),
        failureMessage: t('undoFailed'),
        undo: () => restoreTransaction(orgId, transaction),
      })
      onClose()
    } catch {
      toast.error(t('errors.delete'))
      setConfirm(null)
    } finally {
      setBusy(null)
    }
  }

  // Closing a form that holds changes asks first; an untouched form closes at once.
  const requestClose = () => {
    if (busy) return
    if (dirty) setConfirm('discard')
    else onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented) return
    // Keys typed in a dialog opened from here (a new counterparty) bubble through React but are not ours.
    if (!e.currentTarget.contains(e.target as Node)) return
    if ((e.target as HTMLElement).closest('[role="combobox"],[role="listbox"],button')) return
    e.preventDefault()
    void submit(false)
  }

  const markPaid = () => patch({ status: 'actual', paymentDate: paidDay(state.paymentDate, today) })

  const summary = transaction ? money(transaction.amount, transaction.currency) : ''

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{isEdit ? t('titleEdit') : t('titleNew')}</DialogTitle>
          </DialogHeader>

          <Tabs value={state.type} onValueChange={(value) => changeType(value as TxType)}>
            <TabsList className="w-full">
              <TabsTrigger value="income" className="flex-1 data-active:text-income">
                {t('income')}
              </TabsTrigger>
              <TabsTrigger value="expense" className="flex-1 data-active:text-expense">
                {t('expense')}
              </TabsTrigger>
              <TabsTrigger value="transfer" className="flex-1">
                {t('transfer')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={state.type} className="mt-4 space-y-4">
              <StatusField status={status} locked={futureDate} onChange={(next) => patch({ status: next })} />

              <AmountFields
                state={state}
                status={status}
                accounts={accounts}
                baseCurrency={baseCurrency}
                currency={currency}
                toCurrency={crossCurrency && toAccount ? toAccount.currency : null}
                errors={errors}
                amountRef={amountRef}
                onChange={patch}
              />

              {state.type !== 'transfer' && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="tx-category">{t('category')}</Label>
                    <NativeSelect
                      id="tx-category"
                      wrapperClassName="w-full"
                      value={state.categoryId}
                      onChange={(e) => patch({ categoryId: e.target.value })}
                    >
                      <option value="">{t('noCategory')}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryLabel(c)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  <CounterpartyField orgId={orgId} value={state.counterpartyId} onChange={(id) => patch({ counterpartyId: id })} />
                </>
              )}

              <DatesFields
                paymentDate={state.paymentDate}
                accrual={state.accrual}
                showAccrual={state.type !== 'transfer'}
                errors={errors}
                onChange={patch}
              />

              <div className="space-y-1">
                <Label htmlFor="tx-desc">{t('description')}</Label>
                <Input
                  id="tx-desc"
                  value={state.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder={t('descriptionPlaceholder')}
                />
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-ink"
              >
                {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
              </button>

              {showAdvanced && (
                <div className="space-y-3 rounded-control bg-muted p-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.isRecurring}
                      onChange={(e) => patch({ isRecurring: e.target.checked })}
                      className="accent-brand"
                    />
                    <span className="text-sm">{t('recurring')}</span>
                    {state.isRecurring && (
                      <Badge variant="secondary" className="text-xs">
                        {t('recurringBadge')}
                      </Badge>
                    )}
                  </label>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {isEdit && (
              <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => setConfirm('delete')} className="sm:mr-auto">
                {t('delete')}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={requestClose} className={cn(!isEdit && 'sm:mr-auto')}>
              {tCommon('cancel')}
            </Button>
            {!isEdit && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void submit(true)}>
                {t('addAnother')}
              </Button>
            )}
            {isEdit && status === 'planned' && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={markPaid}>
                {t('markPaid')}
              </Button>
            )}
            <Button type="button" disabled={busy !== null} onClick={() => void submit(false)}>
              {busy === 'save' ? tForms('saving') : isEdit ? tCommon('save') : t('add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm === 'delete'}
        title={t('deleteTitle')}
        body={`${summary}. ${t('deleteBody')}`}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={tCommon('cancel')}
        destructive
        busy={busy === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title={t('discardTitle')}
        body={t('discardBody')}
        confirmLabel={t('discardConfirm')}
        cancelLabel={t('discardStay')}
        onConfirm={onClose}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
```

- [ ] **Step 6: Replace `components/forms/TransactionForm.tsx`** (весь файл) на:

```tsx
// The form lives in ./transaction; this path stays for the lazy loader and the callers.
export { TransactionForm } from '@/components/forms/transaction/TransactionForm'
```

- [ ] **Step 7: Check**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc clean; lint без нових попереджень. Типові місця, де треба виправити, а не заглушити:
- `react-hooks/*` про ref-доступ або setState в effect: у коді вище їх немає; якщо lint скаржиться на `crypto.randomUUID()` у `useRef(...)` (як у старій формі, де це проходило), лишити як було.
- `t(\`errors.${...}\`)` має типізуватись як union наявних ключів; якщо TS скаржиться, перевірити, що Task 9 додав усі ключі в `errors` в усіх трьох мовах.
- `closest('[role="combobox"]…')`: переконатися, що `CounterpartyPicker` має `role="combobox"` на input (так, `aria-label` = «Контрагент»).
- Якщо `Input` не приймає `ref` як проп (React 19: приймає), старий код уже так робив.

Далі запустити всі існуючі unit: `npm run test:unit`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/forms/transaction components/forms/TransactionForm.tsx
git commit -m "feat(transaction-form): rebuilt form with status, two dates, counterparty, rate hint, delete and guards"
```

---

### Task 11: `AccountForm` на токени

**Files:**
- Modify: `components/forms/AccountForm.tsx`

Це лише заміна hex-стилів на токени; поведінка й тексти не змінюються. Палітра кольорів рахунку (`'#00c896'`, `'#6366f1'` … на початку файлу) лишається: це дані (колір, що зберігається в рахунку), а не стиль інтерфейсу.

- [ ] **Step 1: Replace UI hex styles**

Прочитати файл і замінити:
- native `<select className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus:border-[#00c896]">` на `<NativeSelect wrapperClassName="w-full" …>` (імпорт `@/components/ui/native-select`), зберігши `value`, `onChange`, `id`, `<option>`;
- `text-red-500` на `text-expense`;
- кнопку `<Button … style={{ backgroundColor: '#00c896' }}>` на `<Button …>` без `style` (дефолтний варіант теми, як у `CounterpartyForm`);
- інші `gray-*`/`green-*`/`red-*` у розмітці на токени `text-ink-muted`, `bg-muted`, `text-income`, `text-expense`.

Порядок native `<select>` у діалозі рахунку не змінювати: e2e використовує `locator('select').nth(1)` для валюти (тип рахунку перший).

- [ ] **Step 2: Check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:unit`
Expected: чисто; потім переконатися: `grep -n "#[0-9a-fA-F]\{6\}\|text-red-\|text-gray-\|bg-gray-" components/forms/AccountForm.tsx` знаходить лише палітру кольорів рахунку на початку файлу.

```bash
git add components/forms/AccountForm.tsx
git commit -m "style(account-form): design tokens instead of hex colors"
```

---

### Task 12a: Планові операції в журналі

Знахідка e2e: `toTransactions` у `lib/firebase/transactions.ts` залишає лише `actual`, тож планова операція, створена формою, ніде не видна, а «Позначити сплаченою» недосяжне. Рішення власника (2026-10-28): журнал показує планові з міткою «План»; звіти, баланси й календар лишаються як є (їх читання не змінюється). Сума дня планові не враховує.

**Files:**
- Modify: `lib/firebase/transactions.ts`, `lib/utils/journal.ts`, `tests/unit/utils/journal.test.ts`, `app/(app)/[orgSlug]/transactions/page.tsx`, `components/transactions/TransactionList.tsx`, `messages/{uk,pl,en}.json`
- Create: нічого

- [ ] **Step 1: Failing tests** у `tests/unit/utils/journal.test.ts`

Прочитати файл. Хелпер `tx(...)` у ньому будує операції для `summarizeDay`; додати до нього поле `status: 'actual'` за замовчуванням і параметр для зміни статусу (адаптувати наявні виклики мінімально). Додати тести в `describe('summarizeDay', …)`:

```ts
it('does not count planned operations in the sum of the day', () => {
  expect(summarizeDay([tx('income', 1000), { ...tx('expense', 400), status: 'planned' }])).toEqual({ total: 1000, currency: 'UAH' })
})

it('has no sum for a day that holds only planned operations', () => {
  expect(summarizeDay([{ ...tx('expense', 400), status: 'planned' }])).toBeNull()
})
```

Додати також тест для нової чистої функції `isListed` (імпорт з `@/lib/utils/journal`):

```ts
describe('isListed', () => {
  it('actual operations are always listed', () => {
    expect(isListed({ status: 'actual' }, false)).toBe(true)
  })
  it('planned ones only when the journal asks for them', () => {
    expect(isListed({ status: 'planned' }, false)).toBe(false)
    expect(isListed({ status: 'planned' }, true)).toBe(true)
  })
})
```

Run: `npx vitest run tests/unit/utils/journal.test.ts` → FAIL.

- [ ] **Step 2: Implement** у `lib/utils/journal.ts`

Змінити тип параметра `summarizeDay` на `ReadonlyArray<Pick<Transaction, 'type' | 'amount' | 'currency' | 'status'>>`; на початку функції: `const actual = txs.filter((t) => t.status === 'actual')`, `if (actual.length === 0) return null`, і далі весь код працює з `actual` замість `txs` (включно з `currency = counted[0]?.currency ?? actual[0].currency`). Оновити коментар над функцією: планові не входять у суму дня. Додати:

```ts
/** Whether the journal lists an operation: planned ones only when it asks for them (reports and the calendar never do). */
export function isListed(tx: Pick<Transaction, 'status'>, includePlanned: boolean): boolean {
  return tx.status === 'actual' || includePlanned
}
```

- [ ] **Step 3: Reading** у `lib/firebase/transactions.ts`

Додати в `TransactionFilters` поле `includePlanned?: boolean` з коментарем (`The journal lists planned operations too; everything else reads actual ones only`). `toTransactions(orgId, docs, includePlanned)`: замість `else if (tx.status === 'actual')` використати `else if (isListed(tx, includePlanned))` (імпорт `isListed` з `@/lib/utils/journal`), оновити коментар над функцією (прибрати твердження, що UI не створює планові). У `getTransactions` передати `filters.includePlanned ?? false`. Хук `useTransactions` не змінюється: `includePlanned` їде в ключі фільтра.

- [ ] **Step 4: Journal page** `app/(app)/[orgSlug]/transactions/page.tsx`

`useTransactions(orgId, { ...effectiveFilters, includePlanned: true })`. У `TransactionFiltersBar` і в стан `filters` прапорець **не** потрапляє (інакше він порахувався б активним фільтром і з'явилась би кнопка «Очистити»).

- [ ] **Step 5: Marker** у `components/transactions/TransactionList.tsx`

Для `tx.status === 'planned'`: рядок отримує додатковий клас `text-ink-muted` (приглушений вигляд, збережи наявні класи hover/cursor) і `data-status="planned"`; в комірці рахунку, перед рядком категорії/типу рахунку, додати `<Badge variant="chip" className="mt-1">{t('planned')}</Badge>` (видно на всіх ширинах). Мітка не змінює `aria-label` кнопки редагування. Ключ `journal.list.planned`: uk «План», pl «Plan», en «Planned» (додати в усі три файли поруч з `transfer`).

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/unit/utils/journal.test.ts tests/unit/i18n && npx tsc --noEmit && npm run lint && npx vitest run tests/unit`
Expected: усе зелене, нових lint-попереджень немає.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(journal): list planned operations with a marker, outside the day sums"
```

---

### Task 12: E2E

Спочатку **запустити наявні e2e, що торкаються форми**, і виправити їх селектори, якщо вони зламалися через нову розмітку (мітки полів лишились, але `Дата` тепер «Дата платежу», є нові елементи): `ledger.spec.ts`, `smoke.spec.ts`, `app-shell.spec.ts`, `i18n.spec.ts`. Тести не послаблювати: міняти лише локатор на рівноцінний.

**Files:**
- Create: `tests/e2e/transaction-form.spec.ts`
- Modify (за потреби): існуючі e2e вище

- [ ] **Step 1: Run the existing specs**

Run: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/ledger.spec.ts tests/e2e/smoke.spec.ts tests/e2e/app-shell.spec.ts tests/e2e/i18n.spec.ts"`
Expected: PASS. Якщо хтось падає, з'ясувати: чи це зламаний селектор (виправити), чи реальна регресія форми (виправити форму). Відомий нестабільний тест «account row menu» під навантаженням: повторити окремо.

- [ ] **Step 2: Write `tests/e2e/transaction-form.spec.ts`**

Прочитати перед написанням: `tests/e2e/ledger.spec.ts` (хелпери `accountRow`, `balanceText`, `addOperation`, як створюється користувач через `registerViaUi`, як читаються документи через `listDocs`/`readDoc`), `tests/e2e/counterparties.spec.ts` (як там вибирається/створюється контрагент у UI). Файл починається з тих самих `NEEDS_EMULATORS` і `test.skip`. Мова інтерфейсу за замовчуванням в e2e: українська (мітки «Дохід», «Витрата», «Переказ», «Сума», «Опис», «Додати»).

Хелпер у файлі: створити рахунок через `seedLedgerAccount` (компанія PLN), відкрити форму кнопкою шапки («Витрата» тощо), далі працювати всередині `page.getByRole('dialog')` і `dialog.getByRole('tabpanel')`.

Тести (кожен у своїй компанії, `registerViaUi(page, '<prefix>', 'PLN')`):

1. **«an expense with a period and a new counterparty»**: рахунок PLN 1000; відкрити «Витрата»; сума `250`; увімкнути чекбокс «Дата транзакції інша», обрати «Період», з `2026-10-01` до `2026-12-31` (`fill` у `#tx-accrual-from`/`#tx-accrual-to`); у комбобоксі «Контрагент» ввести `Orange` і вибрати «Додати контрагента» → у діалозі контрагента зберегти (ім'я вже підставлено) → він обраний у формі; «Додати». Перевірити через `listDocs`: операція має `accrual` періоду й `counterpartyId` створеного контрагента (знайти його в колекції `counterparties` за ім'ям), баланс рахунку 750,00 у сайдбарі.
2. **«a future date makes the operation planned and does not touch the balance»**: у формі дата платежу `2027-01-15` (завжди в майбутньому на момент написання, або `todayDay() + 30` днів, обчислена в тесті); у `radiogroup` «Статус» кнопка «Факт» disabled, «План» обрана, видно підказку «Платіж у майбутньому…»; сума `100`; «Додати»; баланс не змінився; документ має `status: planned`.
3. **«a planned operation can be marked as paid»**: з попереднього стану відкрити створену планову операцію з журналу (клік по рядку), натиснути «Позначити сплаченою» → `paymentDate` став сьогоднішнім, «Факт» обрано; «Зберегти»; баланс зменшився на 100.
4. **«delete asks first and can be undone»**: створити операцію через UI; відкрити її; «Видалити» → діалог «Видалити операцію?» → «Скасувати» закриває діалог, форма лишається; знову «Видалити» → «Видалити» в діалозі; форма закрилась, баланс повернувся; з'явився тост з «Скасувати»; клік «Скасувати» → операція знову в журналі, баланс як до видалення, документ існує з тим самим id.
5. **«an edit can be undone»**: створити витрату `100`; відкрити, змінити суму на `40`, «Зберегти»; тост «Зміни збережено» → «Скасувати» → у журналі знову `100`, баланс як до редагування.
6. **«closing a changed form asks first»**: відкрити нову форму; ввести суму; `Escape` → діалог «Закрити без збереження?»; «Залишитись» → форма на місці з тією ж сумою; `Escape` → «Закрити» → форма закрита; нічого не створено (`listDocs` порожній). І друга перевірка: порожню форму `Escape` закриває одразу, без питання.
7. **«add and create similar keeps the account and clears the amount»**: рахунок A; «Витрата», сума `10`, опис `x`, «Додати та створити подібний» → форма лишається відкритою, сума й опис порожні, рахунок той самий; сума `20`, «Додати» → у колекції 2 операції.
8. **«a transfer across currencies shows the implied rate»**: рахунки `Konto PLN` (PLN) і `Konto EUR` (EUR) як у `ledger.spec.ts`; «Переказ»; сума `440`, сума зарахування `100` → текст `Курс: 1 EUR = 4,4000 PLN`.
9. **«a foreign amount shows an NBP hint»**: у браузері підмінити відповідь: `await page.route('**/api/rates?**', (route) => route.fulfill({ json: { rate: 4.25, from: 'EUR', to: 'PLN', requestedDate: '<сьогодні>', rateDate: '<вчора>', tableNo: 'x', source: 'NBP_A' } }))`; рахунок EUR; «Витрата», сума `100` → з'являється `≈ 425,00` і `PLN` (формат валюти uk-UA, шукати regex по `425,00`); форму закрити без збереження (збереження в EUR викликало б серверний запит до НБП).
10. **«the counterparty picker works in the form»** (браузерний тест `CounterpartyPicker`, follow-up S06): створити контрагента `Alfa` через сторінку налаштувань або як у `counterparties.spec.ts`; у формі витрати відкрити комбобокс, ввести `alf`, стрілка вниз + Enter обирає `Alfa` (форма при цьому **не** зберігається від Enter); «Без контрагента» знімає вибір.

Для локаторів: комбобокс контрагента `dialog.getByRole('combobox', { name: 'Контрагент' })`, групи: `dialog.getByRole('radiogroup', { name: 'Статус' })` і кнопки `getByRole('radio', { name: 'План' })`, чекбокс `dialog.getByRole('checkbox', { name: 'Дата транзакції інша' })`, тост `page.getByText('Операцію видалено')` і кнопка `getByRole('button', { name: 'Скасувати' })` усередині тосту (`page.locator('[data-sonner-toast]')`).

- [ ] **Step 3: Run**

Run: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/transaction-form.spec.ts"`
Expected: PASS. Нестабільності чекати через `expect(...).toBeVisible()`/`toHaveText`, а не `waitForTimeout`.

- [ ] **Step 4: Rendering in pl and en**

Додати в той самий файл один тест, який перемикає мову (як це робить `i18n.spec.ts`: розділ налаштувань «Мова») на польську й англійську й перевіряє, що в формі нової витрати видно «Data płatności»/«Payment date», «Status», «Kontrahent»/«Counterparty» і немає сирих ключів (`forms.transaction.`). Скопіювати спосіб перемикання з `i18n.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e
git commit -m "test(transaction-form): e2e for status, dates, counterparty, undo, guard and rate hints"
```

---

### Task 13: Документація, повні перевірки, PR

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`

- [ ] **Step 1: `CLAUDE.md`**

Прочитати блок «Counterparties (S06)». Додати поруч короткий блок «Transaction form (S07)» (англійською, у тому ж стилі): чиста логіка в `lib/domain/transaction-form/`; міст `lib/api/transaction-draft.ts` (`stateToDraft`, `buildEditDraft` переносить лише проєкт/теги/файли, `transactionToDraft` для undo); `lib/api/transaction-undo.ts` (видалення відновлюється створенням з тим самим id, редагування відкочується PATCH-ом); форма в `components/forms/transaction/`, `components/forms/TransactionForm.tsx` лише реекспорт; правила статусу (майбутня дата примусово `planned`, «Позначити сплаченою»); `CounterpartyPicker` підключено; сервер не змінювався.

- [ ] **Step 2: Full gates**

```bash
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:rules
npm run test:integration
npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test"
npm run build
```

Expected: усе зелене; лінт без нових попереджень понад базові 13; збережіть числа (unit, rules, integration, e2e) для `PROGRESS.md`. Відомий нестабільний e2e «account row menu» повторити окремо, якщо впав під навантаженням.

- [ ] **Step 3: `PROGRESS.md`**

Додати запис S07 за зразком запису S06 (українською): що зроблено, рішення власника (обсяг, undo-тост, підказка курсу, план/факт за датою + перемикач), проміжні числа тестів з кроку 2, відомі наступні кроки з розділу «Відомі наступні кроки» спеки, і що «Видалення операції в журналі» тепер є з форми редагування (оновити рядки 116 і 244 про відсутність видалення і про форму з двома датами, а в рядках про `CounterpartyPicker` (268, 285, 300) відзначити, що його підключено й покрито браузерним тестом).

- [ ] **Step 4: Commit and report**

```bash
git add CLAUDE.md PROGRESS.md
git commit -m "docs: S07 transaction form in CLAUDE.md and PROGRESS.md"
```

Далі: **не** відкривати PR самостійно. Доповісти контролеру: чи всі гейти зелені, числа тестів, відхилення від плану. Контролер проведе opus-огляд усієї гілки, виправить знахідки й тільки тоді відкриє PR і дочекається зеленого CI та явного «ок» власника на мердж.
